# Migration Status

Current architecture status:

- Core contains protocols, runtime registries, DataPlane, access policy, and watchdog primitives.
- Historical runtime boot code lives under `src/runtime` rather than `src/core`.
- RuntimeKernel, StageOutput, memory, reflection, program, device action, and scene observation are Capabilities.
- LiveWindow and platform adapters live under `src/windows/live`.
- DiscordWindow lives under `src/windows/discord` and can be loaded/unloaded independently.
- Debug uses provider registration and command risk policy.
- EventBus rejects oversized payloads by default.
- DataPlane supports ResourceRef, StreamRef, TTL, metadata listing, permissions, and latest-only stream behavior.
- Debug runtime snapshots expose packages, windows, capabilities, providers, DataPlane metadata, backpressure, security mode, and audit entries.
- Live ingress backpressure preserves paid/high-priority events while dropping or sampling low-priority ordinary chat.

Remaining compatibility areas:

- Legacy cursor code remains only as a compatibility surface for older flows and tests.
- Replay helpers replace direct private-method testing during the compatibility period.
