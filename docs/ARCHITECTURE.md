# Stelle Architecture

Stelle is a modular, event-driven VTuber/Streamer AI runtime. The architecture is built around four boundaries:
Core, Runtime, Capabilities, and Windows.

## Ownership Boundaries

| Layer               | Owns                                                                                                           | Must Not Own                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/core/`         | Protocol contracts, EventBus, config helpers, component registry/loader, DataPlane, resource policy, watchdog. | Concrete capability, window, runtime host, or debug server logic. |
| `src/runtime/`      | `RuntimeHost` bootstrapping, package selection, bootstrap service registration.                                | Domain policy decisions or package internals.                     |
| `src/capabilities/` | Reusable abilities: cognition, expression, memory, program, perception, action, and tooling.                   | Concrete window/platform adapter lifecycle.                       |
| `src/windows/`      | Live/Discord/browser/desktop/stage surfaces, renderer bridge, platform adapters, platform event mapping.       | Reusable cognition, memory, output, or action policy.             |
| `src/debug/`        | Debug server shell, auth, command risk rules.                                                                  | Package internals or platform-specific ownership.                 |

Tool infrastructure now lives in `src/capabilities/tooling/`. Domain-specific tools live with their owning package,
for example `src/windows/live/tools.ts` and `src/capabilities/memory/store/tools.ts`.

## Runtime Lifecycle

`RuntimeHost` in `src/runtime/host.ts` orchestrates startup:

1. Load package-owned config from `config.yaml` and environment variables.
2. Create Core services: `ComponentRegistry`, `ComponentLoader`, `DataPlane`, `StelleEventBus`, and `DebugServer`.
3. Register bootstrap services such as platform runtimes, tools, memory, model client, and scene observer.
4. Select `ComponentPackage`s for the requested mode.
5. Load packages into the registry, then start lifecycle hooks in order.
6. Windows publish platform-neutral events; capabilities subscribe, decide, arbitrate, and emit audit events.

Shutdown stops packages in reverse order, then releases platform runtimes.

## Event Protocol

Cross-domain messages use a generic event envelope in `src/core/event/event_schema.ts`. The EventBus validates the
envelope and payload size; package-owned payloads are validated by the producing or consuming package.

Common event families:

- `perceptual.event`: platform/window ingress converted to `PerceptualEvent`.
- `cognition.intent`: RuntimeKernel output as Core `Intent`.
- `program.interaction.received`, `program.batch.flushed`, `program.tick`: program orchestration events.
- `program.output.proposal`: program capability requests for stage output.
- `stage.output.*`: stage arbiter lifecycle events.
- `device.action.*`: device action arbiter lifecycle events.
- `topic_script.*`: Topic Script generation, approval, runtime, and fallback events.

## Capability And Window Contract

Capabilities own reusable policy and execution logic. Windows own platform ingress, adapter lifecycle, renderer
bridges, and conversion into core protocol events.

Capabilities must not import concrete Windows or `RuntimeHost`. Windows may publish and consume Core events, but should
not import concrete cognition, memory, stage output, or device action implementation classes for policy decisions.

## Output And Device Ownership

All external actions flow through arbiters.

Stage output path:

```text
Window -> perceptual.event -> RuntimeKernel -> cognition.intent
  -> StageOutputCapability -> StageOutputArbiter -> StageWindow renderer bridge
```

Program output path:

```text
Program capability -> program.output.proposal
  -> StageOutputCapability -> StageOutputArbiter -> StageWindow renderer bridge
```

Device action path:

```text
Window or capability -> action service contract
  -> DeviceActionCapability -> DeviceActionArbiter -> device driver package
```

## Design Constraints

- Use `StelleEventBus` for cross-domain communication.
- Use `.js` extensions in TypeScript ESM imports.
- Do not keep compatibility exports for moved implementation files.
- Put secrets in `.env`; committed config files must not contain tokens.
- Add deterministic tests for structural changes. Use evals only for model-behavior changes.
