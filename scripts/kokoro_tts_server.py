"""Small OpenAI-compatible Kokoro TTS server for Stelle.

模块：Kokoro TTS 本地服务

运行逻辑：
1. FastAPI 启动一个 OpenAI-compatible `/v1/audio/speech` HTTP 接口。
2. 请求进入后按 voice/language 选择 Kokoro pipeline，生成 wav 或流式 wav。
3. `/v1/audio/speech/play` 可直接把生成音频播放到本机输出设备。
4. Stelle 的 TypeScript 工具层通过 HTTP 调用该服务，不在 Node 进程里加载 Python 模型。

主要方法：
- `pipeline_for()`：按语言缓存 Kokoro pipeline。
- `speech()`：生成 wav/streaming wav 响应。
- `speech_play()`：生成并播放到本机音频设备。
- `warmup_pipeline()`：启动或手动预热模型。
- `main()`：启动 uvicorn。

Windows usage:
  .venv\\Scripts\\python.exe scripts\\kokoro_tts_server.py

API:
  GET  /health
  GET  /audio/devices
  POST /warmup
  POST /v1/audio/speech
  POST /v1/audio/speech/play
"""

from __future__ import annotations

import io
import os
import struct
import threading
from functools import lru_cache
from typing import Any, Iterator

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field


SAMPLE_RATE = 24000
DEFAULT_WARMUP_TEXT = (
    "\u4f60\u597d\uff0c\u76f4\u64ad\u8bed\u97f3\u9884\u70ed\u5b8c\u6210\u3002"
)


class SpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str = Field(min_length=1)
    voice: str = "zf_xiaobei"
    response_format: str = "wav"
    speed: float = 1.0
    language: str | None = "z"
    stream: bool = False
    output_device: str | int | None = None


app = FastAPI(title="Stelle Kokoro TTS Server", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

preload_error: str | None = None
preloaded_voice: str | None = None
preloaded_language: str | None = None
playback_lock = threading.Lock()


# 模块：模型 pipeline 缓存。
@lru_cache(maxsize=8)
def pipeline_for(lang_code: str):
    from kokoro import KPipeline

    return KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")


# 模块：服务状态与预热路由。
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "engine": "kokoro",
        "sample_rate": SAMPLE_RATE,
        "lazy_loaded": False,
        "preloaded_voice": preloaded_voice,
        "preloaded_language": preloaded_language,
        "preload_error": preload_error,
        "audio_output_device": os.environ.get("KOKORO_AUDIO_DEVICE"),
    }


@app.get("/audio/devices")
async def audio_devices():
    try:
        return {
            "status": "ok",
            "default_output": default_output_device(),
            "devices": list_audio_devices(),
        }
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.on_event("startup")
async def startup_preload() -> None:
    if os.environ.get("KOKORO_PRELOAD", "true").lower() == "false":
        return
    voice = os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
    language = normalize_lang_code(os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
    warmup_text = os.environ.get("KOKORO_WARMUP_TEXT", DEFAULT_WARMUP_TEXT)
    await warmup_pipeline(language, voice, warmup_text)


@app.post("/warmup")
async def warmup(request: SpeechRequest | None = None):
    voice = request.voice if request else os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
    language = normalize_lang_code(request.language if request else os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
    text = (request.input if request else os.environ.get("KOKORO_WARMUP_TEXT", DEFAULT_WARMUP_TEXT)).strip()
    await warmup_pipeline(language, voice, text)
    return {
        "status": "ok",
        "engine": "kokoro",
        "preloaded_voice": preloaded_voice,
        "preloaded_language": preloaded_language,
    }


# 模块：OpenAI-compatible speech 生成路由。
@app.post("/v1/audio/speech")
async def speech(request: SpeechRequest):
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
        audio = np.concatenate(segments)
        return Response(content=to_wav(audio), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


# 模块：直接播放路由。
@app.post("/v1/audio/speech/play")
def speech_play(request: SpeechRequest):
    text = request.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="input is empty")
    lang_code = normalize_lang_code(request.language, request.voice)
    try:
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


# 模块：语言、音频格式与流式 wav helper。
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


# 模块：本机音频设备枚举与播放。
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
    with playback_lock:
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


# 模块：模型预热与 CLI 入口。
async def warmup_pipeline(lang_code: str, voice: str, text: str) -> None:
    global preload_error, preloaded_language, preloaded_voice
    try:
        pipeline = pipeline_for(lang_code)
        for item in pipeline(text, voice=voice, speed=1.0, split_pattern=r"\n+"):
            audio = extract_audio(item)
            if audio is not None and audio.size:
                break
        preload_error = None
        preloaded_language = lang_code
        preloaded_voice = voice
        print(f"[Kokoro] preloaded voice={voice} language={lang_code}", flush=True)
    except Exception as error:
        preload_error = str(error)
        print(f"[Kokoro] preload failed: {preload_error}", flush=True)
        raise


def main() -> None:
    import uvicorn

    host = os.environ.get("KOKORO_TTS_HOST", "127.0.0.1")
    port = int(os.environ.get("KOKORO_TTS_PORT", "8880"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
