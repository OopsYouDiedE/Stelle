# Migration Status

Current architecture status:

- Core contains protocols, the event envelope/EventBus, runtime registries, DataPlane, access policy, and watchdog primitives.
- Historical runtime boot code lives under `src/runtime` rather than `src/core`.
- RuntimeKernel, StageOutput, memory, reflection, program, device action, and scene observation are Capabilities.
- LiveWindow and platform adapters live under `src/windows/live`.
- DiscordWindow lives under `src/windows/discord` and can be loaded/unloaded independently.
- Discord runtime, live event normalization, and stage bridge runtime live under their owning Window areas; `src/utils`
  keeps deprecated re-export shims only.
- Debug uses provider registration and command risk policy.
- DebugProvider's minimum contract lives in `src/core/protocol/debug.ts`; `src/debug/contracts` is a deprecated
  re-export surface.
- EventBus rejects oversized payloads by default.
- DataPlane supports ResourceRef, StreamRef, TTL, metadata listing, permissions, and latest-only stream behavior.
- Debug runtime snapshots expose packages, windows, capabilities, providers, DataPlane metadata, backpressure, security mode, and audit entries.
- Live ingress backpressure preserves paid/high-priority events while dropping or sampling low-priority ordinary chat.

Removed legacy areas:

- Legacy cursor runtime, legacy cursor windows, old debug controller, live-specific debug HTTP APIs, cursor tests,
  and private replay helpers have been removed.
- Remaining runtime entrypoints route through RuntimeHost and ComponentPackage assembly.

Remaining cleanup areas:

- Live-facing tool names still exist for operator tools, but `capability.tooling` owns final ToolRegistry assembly.
- RuntimeKernel's default policy is intentionally small and replaceable; production policy can be swapped through the
  pipeline contract.
- Import boundary tests now guard Core, Capability, Window, and Debug direction rules.
