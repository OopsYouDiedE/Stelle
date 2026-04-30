# Stelle Testing

## Main Checks

```powershell
npm test
npx tsc --noEmit
```

Run both before shipping runtime, cursor, tool, config, or docs-linked structural changes.

For documentation-only changes, at minimum check Markdown links that point to local files and run `npx tsc --noEmit` only when the docs describe moved TypeScript paths or public import contracts.

## Eval Checks

```powershell
npm run test:eval
```

Use evals when changing prompts, routing policy, memory behavior, live moderation, or stage output planning.

## Focused Tests

Vitest can run a single file:

```powershell
npx vitest run test/infra/tools.test.ts
```

Useful areas:

- `test/infra`: tool, SSRF, renderer, and infrastructure behavior.
- `test/cursor`: cursor modularization and queue behavior.
- `test/brain`: inner cursor, memory writer, self model, and field sampler.
- `test/live`: live platform, program, moderation, health, and memory behavior.
- `test/stage`: stage output policy and rendering behavior.
- `test/device`: device action policy, arbiter behavior, and driver boundaries.
- `test/core`: application lifecycle and module wiring.

## Common Failures

- Type failures after moving files usually mean a compatibility export is missing from `src/tool.ts` or `src/utils/config_loader.ts`.
- Event failures usually mean the event payload does not match `src/utils/event_schema.ts`.
- Tool failures usually mean the caller did not provide `allowedTools` or the requested authority tier is missing.
- Live output failures usually mean code bypassed `StageOutputArbiter` or called a stage-owned tool directly.
- Device action failures usually mean the action is missing from the allowlist, uses the wrong authority tier, or bypasses `DeviceActionArbiter`.
- Live platform failures after refactors usually mean an old `src/live/platforms/*`, `src/live/ops/*`, or `src/live/program/*` import should now point at `src/live/adapters/*` or `src/live/controller/*`.
