# Device Action Arbiter

## Overview
The `DeviceActionArbiter` is the central security and resource management component for all device interactions (e.g., Browser, Desktop Input, Android Devices). It ensures that every requested action is structured correctly, meets security risk profiles, and respects resource ownership.

## Core Responsibilities
1.  **Validation**: Every `DeviceActionIntent` is strictly validated using Zod schemas.
2.  **TTL Enforcement**: Intents must have a positive `ttlMs` (Time To Live). Expired intents are rejected immediately.
3.  **Risk Consistency**: Validates that the requested `actionKind` matches the claimed `risk` level (e.g., `observe` must be `readonly`).
4.  **Allowlist Protection**: Enforces a configuration-based allowlist for Cursors, Resources, and Risk levels.
5.  **Focus Locking (Resource Leasing)**: Implements a lease-based locking mechanism. When a Cursor starts an interaction with a resource (like a browser tab), it gains exclusive access for the duration of the `ttlMs`.
6.  **Approval Logic**: High-risk actions (`system`, `external_commit`) or intents flagged with `requiresApproval` are rejected unless an out-of-band approval mechanism is implemented.

## Security Model
Device interactions are disabled by default. The `BrowserCursor`, for example, requires `cursors.browser.enabled: true` in `config.yaml` to function.

### Risk Levels
- `readonly`: Only observation/reading.
- `safe_interaction`: Non-destructive UI interaction (scroll, click navigation).
- `text_input`: Entering text into fields.
- `external_commit`: Actions that persist state externally (e.g., posting a comment).
- `system`: OS-level or dangerous interactions.

## Configuration
Example `config.yaml` snippet:
```yaml
cursors:
  browser:
    enabled: true
    allowlist:
      cursors: ["browser", "inner"]
      risks: ["readonly", "safe_interaction"]
```
