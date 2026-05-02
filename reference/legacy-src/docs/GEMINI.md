# GEMINI.md - Stelle Project Context

## Project Overview

Stelle is a modular, event-driven VTuber/Streamer AI runtime (V2 Architecture). It focuses on creating a "living presence" rather than a simple chatbot.

- **Core Architecture**: Based on a modular multi-cursor design handled by a central `StelleApplication` and domain-isolated `ModuleRegistrars`.
- **Communication**: Uses a global `StelleEventBus` (EventEmitter) for internal decoupling and **Express + Socket.io** for real-time frontend-backend communication.
- **Identity**: Personas evolve based on "Reflection Pressure Valves" (impact and salience-driven reflection) and long-term memory.
- **Unified Actuators**: All speech and actions flow through standard `Arbiters` for coordination and safety.

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

## Development Conventions

- **Event-Driven**: Avoid direct calls between domains or cursors. Use `eventBus.publish(StelleEvent)` and `eventBus.subscribe(type, listener)`.
- **Domain Isolation**: Logic is grouped into `reference/legacy-src/src/memory`, `reference/legacy-src/src/actuator`, `reference/legacy-src/src/cursor`, and `reference/legacy-src/src/live`.
- **Modular Lifecycle**: Major components are managed via `ModuleRegistrar` implementations in `reference/legacy-src/src/core/modules/`.
- **Base Cursor**: New cursors should extend `BaseStatefulCursor` to benefit from the standardized thinking lifecycle.
- **Config**: Static settings in `config.yaml`, sensitive keys in `.env`. Access via `reference/legacy-src/src/config/index.ts`.

## Research & Memory

- **Research Topics**: Stelle can set individuals or behaviors as "Research Topics" in `ResearchLog` to build deep personality profiles over time.
- **Memory Store**: Unified access to recent (JSONL) and long-term (Markdown) storage via `reference/legacy-src/src/memory/memory.ts`.
