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
| `src/runtime/`      | RuntimeHost bootstrapping, package selection, bootstrap service registration.                                | Domain policy decisions or package internals.         |
| `src/capabilities/` | RuntimeKernel, stage output, memory, reflection, program, perception, and action capability implementations. | Platform adapter lifecycle.                           |
| `src/windows/`      | Live/Discord/browser/desktop window surfaces, platform adapters, renderer bridge, platform event mapping.    | Reusable cognition, memory, output, or action policy. |
| `src/debug/`        | Debug server shell, auth, command risk rules, provider contracts.                                            | Package internals or platform-specific panels.        |
| `src/tools/`        | Tool schema, authority tier, registration, safe execution.                                                   | Feature-specific orchestration.                       |

## Runtime Lifecycle

`RuntimeHost` in `src/runtime/host.ts` orchestrates startup:

1. Load runtime config.
2. Create Core services: `ComponentRegistry`, `ComponentLoader`, `DataPlane`, `StelleEventBus`, and `DebugServer`.
3. Register bootstrap services such as platform runtimes, tools, memory, model client, and scene observer.
4. Select `ComponentPackage`s for the requested mode.
5. Load packages into the registry, then start package lifecycle hooks in order.
6. Windows publish platform-neutral events; capabilities subscribe, decide, arbitrate, and emit audit events.

Shutdown stops packages in reverse order, then releases platform runtimes.

## Event Protocol

Cross-domain messages use a generic event envelope in `src/utils/event_schema.ts`.
The EventBus validates only the envelope and payload size; package-owned payloads are validated by the producing or
consuming package.

Common event families:

- `perceptual.event`: platform/window ingress converted to `PerceptualEvent`.
- `cognition.intent`: RuntimeKernel output as Core `Intent`.
- `program.interaction.received`, `program.batch.flushed`, `program.tick`: platform-neutral program orchestration events.
- `program.output.proposal`: program capability requests for stage output.
- `stage.output.*`: stage arbiter lifecycle events.
- `device.action.*`: device action arbiter lifecycle events.
- `topic_script.*`: Topic Script generation, approval, runtime, and fallback events.

When adding an event, keep the envelope generic; define and test payload contracts in the owning package.

## Capability And Window Contract

Capabilities own reusable policy and execution logic. Windows own platform ingress, adapter lifecycle, renderer bridges, and conversion into core protocol events.

Capabilities must not:

- import concrete Window implementations;
- depend on platform adapter details;
- push heavy image/audio/video payloads through the EventBus;
- perform long-running work without a clear timeout or queue boundary.

Windows may publish and consume Core events, but should not import concrete cognition, memory, stage output, or device
action implementation classes.

## Output And Device Ownership

All external actions flow through arbiters.

Stage output path:

```text
Window
  -> perceptual.event
  -> RuntimeKernel
  -> cognition.intent
  -> StageOutputCapability
  -> StageOutputArbiter
  -> StageOutputRenderer
  -> StageWindow renderer bridge

Program capability
  -> program.output.proposal
  -> StageOutputCapability
  -> StageOutputArbiter
  -> StageOutputRenderer
  -> StageWindow renderer bridge
```

Device action path:

```text
Window or capability
  -> action intent/service contract
  -> DeviceActionCapability
  -> DeviceActionArbiter
  -> DeviceActionRenderer
  -> driver service provided by browser_control / desktop_input / android_device package
```

Arbiters publish accepted, queued, rejected/dropped, started, completed, interrupted, or failed events. Consumers should observe those events instead of inferring execution state from direct calls.

## Package Registration

Each package implements `ComponentPackage`:

- `register(context)`: expose service contracts, read models, debug providers, or package-owned adapters.
- `start(context)`: subscribe to events and start background work.
- `stop(context)`: release subscriptions, timers, sockets, and external handles.
- `snapshotState()` / `hydrateState(state)`: transfer package-owned state across unload/reload.
- `prepareUnload()`: describe drain/cancel behavior before unload.

Keep constructors cheap. Expensive I/O belongs in `start()`, not `register()`.

## Design Constraints

- Use `StelleEventBus` for cross-domain communication.
- Use `.js` extensions in TypeScript ESM imports.
- Do not keep old structural compatibility exports for moved implementation files; update imports to the owning package.
- Put secrets in `.env`; committed config files must not contain tokens.
- Add or update deterministic tests for structural changes. Use evals only for model-behavior changes.
