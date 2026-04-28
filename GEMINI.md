# GEMINI.md - Stelle Project Context

## Project Overview
Stelle is a modular, event-driven VTuber/Streamer AI runtime (V2 Architecture). It focuses on creating a "living presence" rather than a simple chatbot. 
- **Core Architecture**: Based on a multi-cursor design (`InnerCursor`, `DiscordCursor`, `LiveCursor`) handled by a central `StelleApplication` container.
- **Communication**: Uses a global `StelleEventBus` (EventEmitter) for internal decoupling and **Express + Socket.io** for real-time frontend-backend communication.
- **Identity**: Personas evolve based on "Reflection Pressure Valves" (impact and salience-driven reflection) and long-term memory.
- **Technologies**: TypeScript, Node.js, Discord.js, Socket.io, Express, Vitest, Gemini/Dashscope APIs.

## Building and Running
- **Install Dependencies**: `npm install`
- **Build Project**: `npm run build` (builds both Live2D client and server)
- **Start Production**: `npm run start` (or specific modes: `start:discord`, `start:live`, `start:runtime`)
- **Development**: `npm run dev` (full stack) or `npm run dev:live` (renderer debug)
- **TTS Service**: `npm run start:kokoro` (requires Python environment)

## Testing and Evals
The project maintains two distinct testing environments:
1. **Deterministic Tests (`test/`)**: Pure logic/mocked LLM tests for CI.
   - Run: `npm run test`
2. **Capabilities Evaluation (`evals/`)**: Real LLM calls for behavioral assessment.
   - Run: `npm run test:eval`
   - Reports are generated in `evals/logs/` in Markdown format.

When expanding either layer, follow [`docs/TEST_AND_EVALS_GUIDE_FOR_GEMINI.md`](docs/TEST_AND_EVALS_GUIDE_FOR_GEMINI.md). In particular, keep deterministic tests free of real network/LLM calls, and build evals from sanitized, curated material rather than ad hoc prompt snippets.

For the concrete eval completion backlog, follow [`docs/GEMINI_EVALS_COMPLETION_TASK.md`](docs/GEMINI_EVALS_COMPLETION_TASK.md).

## Development Conventions
- **Event-Driven**: Avoid direct calls between Cursors. Use `eventBus.publish(StelleEvent)` and `eventBus.subscribe(type, listener)`.
- **Memory Management**: Use `MemoryStore` for both recent (JSONL) and long-term (Markdown) storage.
- **Lifecycle**: All major components must be managed within `src/core/application.ts`.
- **Config**: Static settings in `config.yaml`, sensitive keys in `.env`.
- **Code Style**: Functional reactivity within classes, strict typing, and comprehensive error recording in `RuntimeState`.

## Research & Memory
- **Research Topics**: Stelle can set individuals or behaviors as "Research Topics" in `ResearchLog` to build deep personality profiles over time.
- **Archeology**: Use `memory.search` and history traceback to understand community trajectory.
