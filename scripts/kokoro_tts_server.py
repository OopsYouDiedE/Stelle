"""Small OpenAI-compatible Kokoro TTS server for Stelle.

Windows usage:
  .venv\\Scripts\\python.exe scripts\\kokoro_tts_server.py

API:
  GET  /health
  POST /v1/audio/speech
       { "model": "kokoro", "input": "...", "voice": "zf_xiaobei", "response_format": "wav", "language": "z" }
"""

from __future__ import annotations

import io
import os
from functools import lru_cache
from typing import Any

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field


SAMPLE_RATE = 24000


class SpeechRequest(BaseModel):
    model: str = "kokoro"
    input: str = Field(min_length=1)
    voice: str = "af_heart"
    response_format: str = "wav"
    speed: float = 1.0
    language: str | None = None


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


@lru_cache(maxsize=8)
def pipeline_for(lang_code: str):
    from kokoro import KPipeline

    return KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")


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
    }


@app.on_event("startup")
async def startup_preload() -> None:
    if os.environ.get("KOKORO_PRELOAD", "true").lower() == "false":
        return
    voice = os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
    language = normalize_lang_code(os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
    warmup_text = os.environ.get("KOKORO_WARMUP_TEXT", "你好，直播语音预热完成。")
    await warmup_pipeline(language, voice, warmup_text)


@app.post("/warmup")
async def warmup(request: SpeechRequest | None = None):
    voice = request.voice if request else os.environ.get("KOKORO_TTS_VOICE", "zf_xiaobei")
    language = normalize_lang_code(request.language if request else os.environ.get("KOKORO_TTS_LANGUAGE"), voice)
    text = (request.input if request else os.environ.get("KOKORO_WARMUP_TEXT", "你好，直播语音预热完成。")).strip()
    await warmup_pipeline(language, voice, text)
    return {
        "status": "ok",
        "engine": "kokoro",
        "preloaded_voice": preloaded_voice,
        "preloaded_language": preloaded_language,
    }


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
        segments: list[np.ndarray] = []
        for item in pipeline(text, voice=request.voice, speed=request.speed, split_pattern=r"\n+"):
            audio = extract_audio(item)
            if audio is not None and audio.size:
                segments.append(audio)
        if not segments:
            raise RuntimeError("Kokoro produced no audio")
        audio = np.concatenate(segments)
        return Response(content=to_wav(audio), media_type="audio/wav")
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


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
