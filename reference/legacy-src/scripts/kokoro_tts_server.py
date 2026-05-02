"""Small OpenAI-compatible Kokoro TTS server for Stelle.

模块：Kokoro TTS 本地服务 (优化版)

优化改进点：
1. 使用 @asynccontextmanager (Lifespan) 替代已弃用的 on_event。
2. 修复异步阻塞问题：将 CPU 密集的推理操作路由改为普通 def，交给 FastAPI 内部线程池处理。
3. 播放防堆积：本地播放接口采用非阻塞锁，如果设备被占用直接返回 409，防止 HTTP 请求长时间挂起。
4. 缓存配置化：lru_cache 增加 MAX_PIPELINES 配置，防止多语言切换时显存 OOM。
"""

from __future__ import annotations

import io
import os
import struct
import threading
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, Iterator

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

SAMPLE_RATE = 24000
DEFAULT_WARMUP_TEXT = (
    "\u4f60\u597d\uff0c\u76f4\u64ad\u8bed\u97f3\u9884\u70ed\u5b8c\u6210\u3002"
)
# 可通过环境变量配置缓存中最多同时驻留几个语言模型，防止 OOM
MAX_PIPELINES = int(os.environ.get("KOKORO_MAX_PIPELINES", "3"))


class SpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str = Field(min_length=1)
    voice: str = "zf_xiaobei"
    response_format: str = "wav"
    speed: float = 1.0
    language: str | None = "z"
    stream: bool = False
    output_device: str | int | None = None


# 模块：全局状态与锁
state = {
    "preload_error": None,
    "preloaded_voice": None,
    "preloaded_language": None
}
playback_lock = threading.Lock()


# 模块：模型 pipeline 缓存
@lru_cache(maxsize=MAX_PIPELINES)
def pipeline_for(lang_code: str):
    from kokoro import KPipeline

    repo_id = os.environ.get("KOKORO_REPO_ID", "hexgrad/Kokoro-82M")
    return KPipeline(lang_code=lang_code, repo_id=repo_id)


# 模块：生命周期与预热同步函数
def warmup_pipeline_sync(lang_code: str, voice: str, text: str) -> None:
    """同步版本的预热逻辑，将在线程池中执行"""
    try:
        pipeline = pipeline_for(lang_code)
        for item in pipeline(text, voice=voice, speed=1.0, split_pattern=r"\n+"):
            audio = extract_audio(item)
            if audio is not None and audio.size:
                break
        state["preload_error"] = None
        state["preloaded_language"] = lang_code
        state["preloaded_voice"] = voice
        print(f"[Kokoro] preloaded voice={voice} language={lang_code}", flush=True)
    except Exception as error:
        state["preload_error"] = str(error)
        print(f"[Kokoro] preload failed: {error}", flush=True)
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup 逻辑
    if os.environ.get("KOKORO_PRELOAD", "true").lower() != "false":
        voice = os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
        language = normalize_lang_code(os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
        warmup_text = os.environ.get("KOKORO_WARMUP_TEXT", DEFAULT_WARMUP_TEXT)
        # 将耗时预热放入线程池，防止阻塞启动过程
        await run_in_threadpool(warmup_pipeline_sync, language, voice, warmup_text)
    
    yield  # 应用运行中...
    
    # Shutdown 逻辑：清理模型缓存
    pipeline_for.cache_clear()


app = FastAPI(title="Stelle Kokoro TTS Server", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# 模块：基础 API 路由
@app.get("/health")
def health():
    return {
        "status": "ok",
        "engine": "kokoro",
        "sample_rate": SAMPLE_RATE,
        "audio_output_device": os.environ.get("KOKORO_AUDIO_DEVICE"),
        **state
    }


@app.get("/audio/devices")
def audio_devices():
    try:
        return {
            "status": "ok",
            "default_output": default_output_device(),
            "devices": list_audio_devices(),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/warmup")
async def warmup(request: SpeechRequest | None = None):
    voice = request.voice if request else os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
    language = normalize_lang_code(request.language if request else os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
    text = (request.input if request else os.environ.get("KOKORO_WARMUP_TEXT", DEFAULT_WARMUP_TEXT)).strip()
    
    # 将同步预热放入线程池
    await run_in_threadpool(warmup_pipeline_sync, language, voice, text)
    return {
        "status": "ok",
        "engine": "kokoro",
        "preloaded_voice": state["preloaded_voice"],
        "preloaded_language": state["preloaded_language"],
    }


# 模块：OpenAI-compatible speech 生成路由
# 注意：这里使用普通 def，FastAPI 会自动分配到线程池执行，防止阻塞事件循环
@app.post("/v1/audio/speech")
def speech(request: SpeechRequest):
    text = request.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is empty")
    if request.response_format.lower() != "wav":
        raise HTTPException(status_code=400, detail="only wav response_format is currently supported")

    lang_code = normalize_lang_code(request.language, request.voice)
    try:
        pipeline = pipeline_for(lang_code)
        items = pipeline(text, voice=request.voice, speed=request.speed, split_pattern=r"\n+")
        
        if request.stream:
            return StreamingResponse(stream_wav(items), media_type="audio/wav")
            
        segments: list[np.ndarray] = []
        for item in items:
            audio = extract_audio(item)
            if audio is not None and audio.size:
                segments.append(audio)
        if not segments:
            raise RuntimeError("Kokoro produced no audio")
        
        audio_data = np.concatenate(segments)
        return Response(content=to_wav(audio_data), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


# 模块：直接播放路由
@app.post("/v1/audio/speech/play")
def speech_play(request: SpeechRequest):
    text = request.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is empty")
    
    # 非阻塞锁机制：如果此时本地设备正在播音，直接拒绝新请求，防止卡死
    if not playback_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, 
            detail="Audio device is currently busy playing another stream."
        )

    try:
        lang_code = normalize_lang_code(request.language, request.voice)
        pipeline = pipeline_for(lang_code)
        items = pipeline(text, voice=request.voice, speed=request.speed, split_pattern=r"\n+")
        result = play_audio_items(items, request.output_device)
        return {
            "status": "ok",
            "engine": "kokoro",
            "sample_rate": SAMPLE_RATE,
            "voice": request.voice,
            "language": lang_code,
            "text_length": len(text),
            **result,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        # 确保播放完毕或发生异常时释放锁
        playback_lock.release()


# 模块：语言、音频格式与流式 wav helper
def normalize_lang_code(language: str | None, voice: str) -> str:
    if language and len(language.strip()) == 1:
        return language.strip().lower()
    if voice:
        return voice[0].lower()
    return "a"


def extract_audio(item: Any) -> np.ndarray | None:
    audio = getattr(item, "audio", None)
    if audio is None and isinstance(item, tuple) and len(item) >= 3:
        audio = item[2]
    if audio is None:
        return None
    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()
    elif hasattr(audio, "numpy"):
        audio = audio.numpy()
    return np.asarray(audio, dtype=np.float32).reshape(-1)


def to_wav(audio: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV")
    return buffer.getvalue()


def stream_wav(items: Iterator[Any]):
    produced = False
    yield wav_stream_header(SAMPLE_RATE)
    for item in items:
        audio = extract_audio(item)
        if audio is not None and audio.size:
            produced = True
            yield pcm16_bytes(audio)
    if not produced:
        raise RuntimeError("Kokoro produced no audio")


def wav_stream_header(sample_rate: int) -> bytes:
    channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
    data_size = 0xFFFFFFFF
    riff_size = 36 + data_size
    return b"RIFF" + struct.pack(
        "<I4s4sIHHIIHH4sI",
        riff_size & 0xFFFFFFFF,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )


def pcm16_bytes(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


# 模块：本机音频设备枚举与播放
def list_audio_devices() -> list[dict[str, Any]]:
    import sounddevice as sd

    devices = []
    for index, info in enumerate(sd.query_devices()):
        devices.append(
            {
                "index": index,
                "name": info["name"],
                "hostapi": info["hostapi"],
                "max_input_channels": info["max_input_channels"],
                "max_output_channels": info["max_output_channels"],
                "default_samplerate": info["default_samplerate"],
            }
        )
    return devices


def default_output_device() -> dict[str, Any] | None:
    import sounddevice as sd

    default = sd.default.device
    index = default[1] if isinstance(default, (list, tuple)) else default
    if index is None or index < 0:
        return None
    info = sd.query_devices(index)
    return {"index": index, "name": info["name"]}


def resolve_output_device(device: str | int | None) -> tuple[int | None, str]:
    import sounddevice as sd

    requested = device if device is not None else os.environ.get("KOKORO_AUDIO_DEVICE")
    if requested is None or requested == "":
        default = default_output_device()
        return None, default["name"] if default else "system default output"
    
    if isinstance(requested, int) or str(requested).strip().isdigit():
        index = int(requested)
        info = sd.query_devices(index)
        if info["max_output_channels"] <= 0:
            raise HTTPException(status_code=400, detail=f"audio device {index} has no output channels")
        return index, info["name"]

    needle = str(requested).strip().lower()
    for index, info in enumerate(sd.query_devices()):
        if info["max_output_channels"] > 0 and needle in str(info["name"]).lower():
            return index, info["name"]
    raise HTTPException(status_code=400, detail=f"audio output device not found: {requested}")


def play_audio_items(items: Iterator[Any], output_device: str | int | None) -> dict[str, Any]:
    import sounddevice as sd

    device_index, device_name = resolve_output_device(output_device)
    frames = 0
    chunks = 0
    blocksize = int(os.environ.get("KOKORO_AUDIO_BLOCKSIZE", "0"))
    
    # 注意：锁的获取和释放已移至路由函数外层，这里只需要安心播音即可
    with sd.OutputStream(
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype="float32",
        device=device_index,
        blocksize=blocksize,
    ) as stream:
        for item in items:
            audio = extract_audio(item)
            if audio is None or not audio.size:
                continue
            chunk = np.asarray(audio, dtype=np.float32).reshape(-1, 1)
            stream.write(chunk)
            frames += int(chunk.shape[0])
            chunks += 1
            
    if chunks == 0:
        raise RuntimeError("Kokoro produced no audio")
    
    return {
        "device": device_name,
        "frames": frames,
        "chunks": chunks,
        "duration_ms": round(frames / SAMPLE_RATE * 1000),
    }


def main() -> None:
    import uvicorn

    host = os.environ.get("KOKORO_TTS_HOST", "127.0.0.1")
    port = int(os.environ.get("KOKORO_TTS_PORT", "8880"))
    uvicorn.run("kokoro_tts_server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()