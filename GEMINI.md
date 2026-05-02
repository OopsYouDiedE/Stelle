# GEMINI.md - Stelle Project Context

## Project Overview

Stelle is a modular, event-driven VTuber/Streamer AI runtime (V2 Architecture). It focuses on creating a "living presence" rather than a simple chatbot.

- **Core Architecture**: Based on strict Core / Debug / Capability / Window boundaries handled by `RuntimeHost` and `ComponentPackage` lifecycle.
- **Communication**: Uses a global `StelleEventBus` (EventEmitter) for internal decoupling and **Express + Socket.io** for real-time frontend-backend communication.
- **Identity**: Personas evolve based on "Reflection Pressure Valves" (impact and salience-driven reflection) and long-term memory.
- **Unified Capabilities**: Speech, memory, reflection, program flow, perception, and actions live in capability packages with explicit boundaries.

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

- **Event-Driven**: Avoid direct writes across packages. Use `eventBus.publish(StelleEvent)`, Core protocol objects, package services, and DataPlane refs.
- **Domain Isolation**: Logic is grouped into `src/core`, `src/runtime`, `src/capabilities`, `src/windows`, and `src/debug`.
- **Modular Lifecycle**: Major components are registered through package-owned `register()` hooks and the runtime package registry.
- **Runtime Surfaces**: Platform behavior lives under the owning Window package, while shared capability logic stays in `src/capabilities`.
- **Config**: Static settings in `config.yaml`, sensitive keys in `.env`. Access config through the owning package config helpers or `src/core/config/runtime_config.ts`.

## Research & Memory

- **Research Topics**: Stelle can set individuals or behaviors as "Research Topics" in `ResearchLog` to build deep personality profiles over time.
- **Memory Store**: Unified access to recent (JSONL) and long-term (Markdown) storage via `src/capabilities/memory/store/memory_store.ts`.
