# Bilibili Live Runbook

This is the short operational checklist for the first real Bilibili live run.

## Required Local Environment

Set these in `.env` before going live:

```text
DASHSCOPE_API_KEY=...        # or GEMINI_API_KEY
STELLE_CONTROL_TOKEN=...     # generated locally; keep secret
BILIBILI_ROOM_ID=...         # your live room id
BILIBILI_COOKIE=...          # optional, use if preflight reports Bilibili risk control
LIVE_TTS_ENABLED=true        # set false for caption-only dry run
STELLE_TTS_PROVIDER=dashscope # dashscope for Qwen-TTS, kokoro for local fallback
LIVE_SPEECH_QUEUE_LIMIT=3    # keep two or three utterances buffered
```

`STELLE_CONTROL_TOKEN` protects the local renderer control API. The Bilibili bridge reads it from `.env` and sends it as a bearer token.

If preflight reports `code=-352`, Bilibili is risk-controlling anonymous API access. Open `https://live.bilibili.com/<room id>` in a logged-in browser, copy the request Cookie for `live.bilibili.com`, and put it in local `.env` as `BILIBILI_COOKIE`. Do not commit it.

## Live Audio

For Qwen-TTS live speech, use DashScope / Aliyun Bailian:

```text
STELLE_TTS_PROVIDER=dashscope
DASHSCOPE_API_KEY=...
QWEN_TTS_LIVE_MODEL=qwen3-tts-instruct-flash
QWEN_TTS_VOICE=Cherry
QWEN_TTS_LANGUAGE_TYPE=Chinese
QWEN_TTS_INSTRUCTIONS=语气活泼、亲切，像虚拟主播直播间即时回应。语速中等偏快，句尾自然。
QWEN_TTS_OPTIMIZE_INSTRUCTIONS=true
```

Keep `QWEN_TTS_STREAMING=false` for browser playback unless the DashScope realtime stream path is being tested deliberately. The renderer can proxy DashScope SSE chunks into a WAV response, but the normal live path follows the generated audio URL for more predictable OBS browser-source playback.

## Preflight

Run this before every formal live:

```bash
npm run build
npm run live:preflight
```

The preflight should have no `FAIL` rows. A renderer HTTP warning is acceptable before the renderer is started.

## Start Order

Use three terminals:

```bash
npm run start:live
```

Open OBS and add a Browser Source:

```text
http://127.0.0.1:8787/live?autoplay=1
```

`/live` is the real stage path. It does not generate sample danmaku; content enters through the live bridge and is arbitrated by `StageOutputArbiter`. Add `?panel=1` only for the local simulator/debug panel.

Then start the Bilibili danmaku bridge:

```bash
npm run live:bilibili
```

For a non-forwarding connection test:

```bash
npm run live:bilibili -- --dry-run
```

## On-Air Safety

- Keep `OBS_CONTROL_ENABLED=false` unless OBS control is intentionally implemented and tested.
- Keep `STELLE_DEBUG_ENABLED=false` for public streams.
- If TTS fails, set `LIVE_TTS_ENABLED=false` and continue with captions.
- The live gateway hard-drops political/current-affairs content before it reaches the model.
- The stage arbiter owns captions/TTS/motion, so cursors cannot directly fight over live output.

## Known Limits

- OBS start/stop automation is not implemented; start streaming from OBS manually.
- Bilibili danmaku uses the public web room message stream. If Bilibili changes the protocol or rate-limits anonymous access, rerun `npm run live:preflight` and test `npm run live:bilibili -- --dry-run`.
