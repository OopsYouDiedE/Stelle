# Stelle Operations

## Install

```powershell
npm install
```

Node.js 20 or newer is required.

## Build

```powershell
npm run build
```

The build compiles the renderer with Vite and TypeScript runtime files into `dist/`.

## Start Modes

```powershell
npm run start:runtime
npm run start:discord
npm run start:live
```

- `runtime`: renderer, live services, inner cursor, and Discord when `DISCORD_TOKEN` is set.
- `discord`: Discord-only runtime.
- `live`: renderer and live services without Discord connection.

Development modes use the `dev:*` scripts in `package.json`.

## Configuration

Configuration is loaded from `config.yaml` plus environment variables. Secrets belong in `.env`, not in committed files.

Common variables:

- `DISCORD_TOKEN`
- `DASHSCOPE_API_KEY`, `GEMINI_API_KEY`, or `OPENAI_API_KEY`
- `STELLE_PRIMARY_MODEL`, `STELLE_SECONDARY_MODEL`
- `LIVE_RENDERER_HOST`, `LIVE_RENDERER_PORT`
- `STELLE_DEBUG_ENABLED`, `STELLE_DEBUG_TOKEN`
- `STELLE_CONTROL_TOKEN`
- live platform variables such as `BILIBILI_ROOM_ID`, `TWITCH_CHANNEL`, `YOUTUBE_LIVE_CHAT_ID`, `TIKTOK_USERNAME`

## Renderer And Control

When live mode is active, the renderer is served at:

```text
http://127.0.0.1:8787/live
```

The control page is:

```text
http://127.0.0.1:8787/control
```

If control tokens are required, use a Bearer token or the local control page token query during manual operation.

## Debug

Debug routes are only available when `STELLE_DEBUG_ENABLED=true`.

```text
/_debug
/_debug/api/snapshot
/_debug/api/tool/use
```

Do not expose debug routes on a public interface.
