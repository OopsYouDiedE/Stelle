# Stelle Architecture (V2 Modular)

Stelle is a modular, event-driven VTuber/Streamer AI runtime. It is organized around Core, Debug, Capability, and Window boundaries so reusable abilities stay separate from platform surfaces.

For a practical code navigation map, read [`CODEBASE_GUIDE.md`](CODEBASE_GUIDE.md). This document is the architectural contract.

## Core Pillars

1. **Event-driven decoupling**: major domains communicate through `StelleEventBus` and `StelleEventSchema`.
2. **Hard ownership boundaries**: `src/core/` owns contracts and runtime substrate; `src/capabilities/` owns reusable abilities; `src/windows/` owns platform/window composition; `src/debug/` owns the control-plane shell.
3. **Capability lifecycle**: packages expose services, read models, debug providers, and optional snapshot/hydrate hooks through `ComponentPackage`.
4. **Unified arbiters**: stage output and device actions are proposed as intents, then accepted, queued, rejected, executed, and audited by capability arbiters.
5. **Tool-mediated side effects**: external effects go through `ToolRegistry` or explicit device/stage renderers.

## Ownership Boundaries

| Layer               | Owns                                                                                                         | Must Not Own                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `src/core/`         | Protocol contracts, component registry/loader, DataPlane, scheduler/watchdog, security primitives.           | Concrete Capability, Window, Debug panel logic.       |
| `src/runtime/`      | Application boot, service container, static package/module wiring, legacy cursor runtime host.               | Domain policy decisions.                              |
| `src/capabilities/` | RuntimeKernel, stage output, memory, reflection, program, perception, and action capability implementations. | Platform adapter lifecycle.                           |
| `src/windows/`      | Live/Discord/browser/desktop window surfaces, platform adapters, renderer bridge, platform event mapping.    | Reusable cognition, memory, output, or action policy. |
| `src/debug/`        | Debug server shell, auth, command risk rules, provider contracts.                                            | Package internals or platform-specific panels.        |
| `src/tools/`        | Tool schema, authority tier, registration, safe execution.                                                   | Feature-specific orchestration.                       |

## Runtime Lifecycle

`StelleApplication` in `src/runtime/application.ts` orchestrates startup:

1. Load runtime config.
2. `StelleContainer.createServices()` creates shared services: LLM, memory, event bus, live runtime, Discord runtime, tools, arbiters, viewer profiles, scene observer.
3. In `runtime` or `live` mode, start `LiveRendererServer` and attach a local renderer bridge.
4. `selectCursorModules()` chooses window/capability-owned legacy cursor manifests for the current mode and initializes each Cursor with an immutable `CursorContext`.
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

## Capability And Window Contract

Capabilities own reusable policy and execution logic. Windows own platform ingress, adapter lifecycle, renderer bridges, and conversion into core protocol events.

Capabilities must not:

- import concrete Window implementations;
- depend on platform adapter details;
- push heavy image/audio/video payloads through the EventBus;
- perform long-running work without a clear timeout or queue boundary.

Windows may compose capabilities, but should not reimplement cognition, memory, stage output, or device action policy.

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
- Do not keep old structural compatibility exports for moved implementation files; update imports to the owning package.
- Put secrets in `.env`; committed config files must not contain tokens.
- Add or update deterministic tests for structural changes. Use evals only for model-behavior changes.
