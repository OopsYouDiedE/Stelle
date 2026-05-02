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

## Component Packages

`ComponentPackage` is the runtime-loadable unit. Packages declare ownership with an id, kind, version, requirements,
provisions, optional backpressure policy, and lifecycle hooks:

1. `register(ctx)` exposes services, handlers, read models, and debug providers.
2. `hydrateState(state)` restores transferable state when a previous snapshot exists.
3. `start(ctx)` begins active work.
4. `prepareUnload()` declares whether pending work drains, cancels, hands off, or drops expired work.
5. `snapshotState()` captures transferable state.
6. `stop(ctx)` stops active work.
7. Package-owned registry entries are removed on unload.

Ephemeral state is discarded, durable state is written through stores, and transferable state moves through snapshot and
hydration. Long-running model calls may finish and be ignored if stale; perfect transfer of every async call is not
required.

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

## Data Plane

The EventBus carries control-plane facts: perceptual events, intents, execution results, status changes, audit, and
debug command events. Heavy data belongs in `DataPlane`:

- images, video frames, audio chunks, and streams
- long text or JSON blobs
- browser, scene, and embedding snapshots

Event payloads are capped. Larger payloads should be stored with `DataPlane.putBlob()` or
`DataPlane.createStream()`, then referenced by `ResourceRef` or `StreamRef`. This bypasses only the heavy-data path; it
does not bypass lifecycle, audit, access policy, or ownership.

## Capability And Window Contract

Capabilities own reusable policy and execution logic. Windows own platform ingress, adapter lifecycle, renderer
bridges, and conversion into core protocol events.

Capabilities must not import concrete Windows or `RuntimeHost`. Windows may publish and consume Core events, but should
not import concrete cognition, memory, stage output, or device action implementation classes for policy decisions.

Capability queues should declare bounded policy when they process bursty input. Use `lossless` for paid events, user
commands, and critical execution results; `bounded` for normal chat, moderate JSON, and audio chunks; `latest-only` for
video frames, mouse position, device status, and render state.

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
- Debug is a control-plane shell. Remote debug defaults must be conservative, token-protected, audited, and limited to
  provider-owned commands.
