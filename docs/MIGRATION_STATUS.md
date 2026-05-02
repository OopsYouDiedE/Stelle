# Migration Status

Current architecture status:

- Core contains protocols, EventBus/EventSchema, config helpers, runtime registries, DataPlane, access policy, and watchdog primitives.
- Historical runtime boot code routes through `src/runtime/host.ts`.
- RuntimeKernel, StageOutput, memory, reflection, program, device action, tooling, and scene observation are Capabilities.
- LiveWindow and platform adapters live under `src/windows/live`.
- DiscordWindow and Discord runtime live under `src/windows/discord`.
- Live event normalization lives under `src/windows/live/live_event.ts`.
- Stage bridge runtime lives under `src/windows/stage/bridge/live_runtime.ts`.
- Debug uses provider registration and command risk policy.
- Import boundary tests guard Core, Capability, Window, and Debug direction rules.

Removed legacy areas:

- `src/utils/`
- `src/tools/`
- `src/config/`
- `src/tool.ts`
- `src/runtime_state.ts`
- `src/runtime/application.ts`
- old test buckets: `test/brain`, `test/device`, `test/live`, `test/stage`, `test/utils`, `test/infra`

Current validation targets:

- `npx tsc --noEmit`
- `npm test`
- `npm run build`
