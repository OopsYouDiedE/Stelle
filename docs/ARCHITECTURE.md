# Stelle Architecture

Stelle is a TypeScript runtime built around event-driven cursors, a guarded tool layer, and explicit arbiters for scarce output or device resources.

## Runtime Shape

- `src/core/application.ts` owns startup order, cursor creation, event wiring, debug wiring, and shutdown.
- `src/core/container.ts` creates shared runtime services once. Renderer startup attaches a renderer bridge to the existing `LiveRuntime`; it must not recreate the whole service graph.
- `src/core/live_services.ts` owns live platform, health, journal, relationship, engagement, and program service lifecycle.
- `src/core/live_control_service.ts` owns live control commands and system/debug output proposals.
- `src/config/` owns config parsing. `src/utils/config_loader.ts` is only a compatibility export.

## Cursor Boundary

Cursors observe one domain and produce decisions. They may use:

- `StelleEventBus` for cross-domain communication.
- `ToolRegistry` for allowed tools.
- `StageOutputArbiter` for live stage output.
- `DeviceActionArbiter` for browser, desktop, or Android actions.

Cursors must not directly call another cursor. Cross-cursor influence goes through events, especially `cursor.directive`.

## Tool Boundary

The public tool API is exported from `src/tool.ts`, which re-exports `src/tools/`.

- `src/tools/types.ts`: tool contracts and result helpers.
- `src/tools/registry.ts`: authority, whitelist, audit, and stage-owned tool checks.
- `src/tools/security.ts`: public HTTP URL validation for network-read tools.
- `src/tools/factory.ts` and `src/tools/providers/`: default tool registration and implementations.

Cursor and core callers that use `safe_write`, `external_write`, or `system` tools must provide an explicit `allowedTools` whitelist.

## Output And Device Ownership

Live stage output must flow through:

`Cursor -> OutputIntent -> StageOutputArbiter -> StageOutputRenderer -> ToolRegistry -> LiveRuntime`

Stage-owned live tools such as captions, TTS, motion, and expressions must not be called directly by cursors.

Device actions must flow through:

`Cursor -> DeviceActionIntent -> DeviceActionArbiter -> DeviceActionRenderer -> Driver`

Device actions require an allowlist and are denied by default.

## Forbidden Paths

- Cursor-to-cursor direct method calls.
- Cursor direct calls to live stage tools.
- Runtime service graph recreation after renderer startup.
- New tool execution paths that bypass `ToolRegistry`.
- Writes to long-term memory that bypass the memory writer or tool whitelist path.
