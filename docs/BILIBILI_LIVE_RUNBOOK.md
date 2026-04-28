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
```

`STELLE_CONTROL_TOKEN` protects the local renderer control API. The Bilibili bridge reads it from `.env` and sends it as a bearer token.

If preflight reports `code=-352`, Bilibili is risk-controlling anonymous API access. Open `https://live.bilibili.com/<room id>` in a logged-in browser, copy the request Cookie for `live.bilibili.com`, and put it in local `.env` as `BILIBILI_COOKIE`. Do not commit it.

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
http://127.0.0.1:8787/live
```

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
