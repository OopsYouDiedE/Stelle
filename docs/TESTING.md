# Stelle Testing

## Main Checks

```powershell
npm test
npx tsc --noEmit
```

Run both before shipping runtime, cursor, tool, config, or docs-linked structural changes.

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
- `test/stage`: stage output arbitration.

## Common Failures

- Type failures after moving files usually mean a compatibility export is missing from `src/tool.ts` or `src/utils/config_loader.ts`.
- Event failures usually mean the event payload does not match `src/utils/event_schema.ts`.
- Tool failures usually mean the caller did not provide `allowedTools` or the requested authority tier is missing.
- Live output failures usually mean code bypassed `StageOutputArbiter` or called a stage-owned tool directly.
