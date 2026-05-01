# Stelle Architecture (V2 Modular)

Stelle is a modular, event-driven VTuber/Streamer AI runtime. It uses multi-cursor decision making, unified actuators, and domain-isolated modules to create a persistent "living presence".

For a practical code navigation map, read [`CODEBASE_GUIDE.md`](CODEBASE_GUIDE.md). This document is the architectural contract.

## Core Pillars

1. **Event-driven decoupling**: major domains communicate through `StelleEventBus` and `StelleEventSchema`.
2. **Domain isolation**: Core, Discord, Live, and Actuator wiring lives behind `ModuleRegistrar` implementations.
3. **Cursor autonomy**: Cursor modules own domain decisions and expose lifecycle/snapshot methods through shared Cursor interfaces.
4. **Unified actuators**: stage output and device actions are proposed as intents, then accepted, queued, rejected, executed, and audited by arbiters.
5. **Tool-mediated side effects**: external effects go through `ToolRegistry` or explicit device/stage renderers.

## Ownership Boundaries

| Layer                  | Owns                                                                                                       | Must Not Own                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/core/`            | Application lifecycle, shared service creation, module registration, scheduler, debug/control composition. | Domain policy decisions.                          |
| `src/cursor/`          | Per-domain perception, routing, LLM/tool planning, snapshots, reflections.                                 | Direct renderer/device/platform side effects.     |
| `src/live/adapters/`   | Platform connections and ingress normalization.                                                            | Stage policy, LLM decisions, topic orchestration. |
| `src/live/controller/` | Live room business state: director, journal, health, relationships, Topic Script runtime.                  | Low-level renderer server details.                |
| `src/actuator/`        | Intent arbitration and audit event publication.                                                            | Platform-specific driver code.                    |
| `src/stage/`           | Output policy, budget, queue, and final stage rendering.                                                   | Cursor decisions or platform ingress.             |
| `src/device/`          | Device action policy, allowlist, renderer, drivers.                                                        | Cursor routing or live room logic.                |
| `src/tools/`           | Tool schema, authority tier, registration, safe execution.                                                 | Feature-specific orchestration.                   |

## Runtime Lifecycle

`StelleApplication` in `src/core/application.ts` orchestrates startup:

1. Load runtime config.
2. `StelleContainer.createServices()` creates shared services: LLM, memory, event bus, live runtime, Discord runtime, tools, arbiters, viewer profiles, scene observer.
3. In `runtime` or `live` mode, start `LiveRendererServer` and attach a local renderer bridge.
4. `selectCursorModules()` chooses Cursor manifests for the current mode and initializes each Cursor with an immutable `CursorContext`.
5. Module registrars wire domain event listeners and services.
6. Optional Discord connection starts when a token is available and the mode allows it.
7. Module `start()` hooks run, then `StelleScheduler` starts ticks.

Shutdown reverses the lifecycle: stop scheduler, cursors, modules, Discord, and renderer, then update runtime state.

## Event Protocol

Cross-domain messages must be represented in `src/utils/event_schema.ts`.

Common event families:

- `core.tick`, `inner.tick`, `live.tick`, `presence.tick`: scheduled heartbeat events.
- `discord.*.received`: Discord ingress.
- `live.event.*`, `live.danmaku.received`, `live.batch.flushed`: live ingress and batching.
- `live.output.proposal`: live business logic proposing stage output.
- `stage.output.*`: stage arbiter lifecycle events.
- `device.action.*`: device action arbiter lifecycle events.
- `cursor.directive`: runtime policy overlays sent to Cursors.
- `topic_script.*`: Topic Script generation, approval, runtime, and fallback events.

When adding an event, update schema first, then producers, then consumers, then tests.

## Cursor Contract

Cursors may read from `CursorContext` and publish events, propose stage output, propose device actions, call tools through the registry, and update their own state.

Cursors must not:

- call another Cursor instance directly;
- mutate `CursorContext`;
- bypass `ToolRegistry`;
- call `StageOutputRenderer`, platform adapters, or device drivers directly;
- perform long-running work without a clear timeout or queue boundary.

The preferred internal decomposition is Gateway -> Router -> Executor -> Responder. `BaseStatefulCursor` provides common lifecycle and policy overlay plumbing for cursors that use this pattern.

## Output And Device Ownership

All external actions flow through arbiters.

Stage output path:

```text
Cursor/LiveStageDirector
  -> live.output.proposal or OutputIntent
  -> StageOutputArbiter
  -> StageOutputRenderer
  -> ToolRegistry
  -> LiveRuntime / renderer / Discord reply
```

Device action path:

```text
Cursor
  -> DeviceActionArbiter
  -> DeviceActionRenderer
  -> BrowserCdpDriver / DesktopInputDriver / AndroidAdbDriver
```

Arbiters publish accepted, queued, rejected/dropped, started, completed, interrupted, or failed events. Consumers should observe those events instead of inferring execution state from direct calls.

## Module Registration

Each domain module implements `ModuleRegistrar`:

- `register(services)`: wire event listeners and create domain services.
- `start()`: start background loops, platform bridges, journals, or runtime services.
- `stop()`: release subscriptions, timers, sockets, and files.

Keep constructors cheap. Expensive I/O belongs in `start()`, not `register()`.

## Design Constraints

- Use `StelleEventBus` for cross-domain communication.
- Use `.js` extensions in TypeScript ESM imports.
- Keep compatibility exports only when tests or public imports still need them.
- Put secrets in `.env`; committed config files must not contain tokens.
- Add or update deterministic tests for structural changes. Use evals only for model-behavior changes.
