# Backpressure Policy

Backpressure exists at three layers:

1. Window ingress rate limiting.
2. EventBus and DataPlane bounded queues.
3. Capability-owned queue policy.

Queue semantics:

- `lossless`: paid events, user commands, critical execution results.
- `bounded`: normal chat, moderate JSON, audio chunks.
- `latest-only`: video frames, mouse position, device status, render state.

Packages may declare `PackageBackpressurePolicy` with `maxQueueSize`, `overflow`, and optional `priorityKey`.

`BackpressureStatus` reports buffered items, dropped items, lag, and recommended action. Stream latest-only status should recommend `latest_only`; full bounded queues should recommend `slow_down` or dropping low-priority work.
