# Stelle Testing Conventions

这份文档说明测试分层、何时运行哪些检查，以及常见失败如何定位。

## Required Checks

普通代码改动提交前运行：

```powershell
npm run format:check
npx tsc --noEmit
npm test
```

`npm test` 运行确定性 Vitest 测试，不应该依赖真实 LLM、真实 Discord、真实直播平台或公网。

## Focused Tests

可以先跑单个测试文件缩短反馈：

```powershell
npx vitest run test/infra/tools.test.ts
npx vitest run test/brain/memory_rag.test.ts
```

常用目录：

- `test/infra`：工具、安全、renderer、SSRF、OBS/controller glue。
- `test/cursor`：Cursor 模块化、gateway、队列和工具执行。
- `test/brain`：inner cursor、memory writer、self model、field sampler、memory RAG。
- `test/live`：直播平台、节目控制、moderation、health、viewer profile。
- `test/stage`：舞台输出策略、预算、队列和 arbiter。
- `test/device`：设备动作策略、allowlist、arbiter、driver。
- `test/core`：应用生命周期和模块装配。
- `test/integration`：跨模块确定性集成流。

## Eval Checks

真实模型评估使用：

```powershell
npm run test:eval
```

以下改动需要 eval：

- Prompt 或 LLM output schema。
- 路由策略、intent 分类、工具规划。
- 记忆生成、长期记忆策略、RAG 检索语义。
- 直播 moderation、话题规划、舞台输出规划。
- Topic Script 生成、审核、运行时决策。

Eval 报告生成在 `evals/logs/`，属于运行产物，不参与格式化和源码提交规范。

## Documentation Changes

只改文档时：

- 运行 `npm run format:check`。
- 如果文档引用了 TypeScript 路径、公共入口或结构迁移，再运行 `npx tsc --noEmit`。
- 如果文档描述测试或 eval 行为，确认命令仍存在于 `package.json`。

## Refactor Changes

结构重构时至少运行：

```powershell
npm run format:check
npx tsc --noEmit
npm test
npm run build
```

重构公共入口时，注意这些仍作为公共入口存在的文件：

- `src/tool.ts`
- `src/tools/index.ts`
- `src/tools/providers/default_tools.ts`

## Memory Tests

修改 `src/capabilities/memory/` 时至少覆盖：

- recent JSONL 读写和 corrupt line 忽略。
- checkpoint 压缩和恢复。
- long-term layer 读写。
- proposal approve/reject。
- relevance scoring，特别是多条件查询不能被单一重复关键词带偏。

快速命令：

```powershell
npx vitest run test/brain/memory_rag.test.ts
```

## Common Failures

- Type failures after moving files usually mean an import still points at an old boundary.
- Event failures usually mean the envelope does not match `src/core/event/event_schema.ts`, or a package rejected its
  own payload contract.
- Tool failures usually mean missing `allowedTools`, wrong authority tier, or bypassed ToolRegistry.
- Live output failures usually mean code bypassed `StageOutputArbiter`.
- Device action failures usually mean action allowlist or `DeviceActionArbiter` was bypassed.
- Memory search failures usually mean scoring became too keyword-heavy or filtered valid single-keyword queries completely.
- Live platform failures after refactors usually mean an old path should now point to `src/windows/live/*` or the relevant `src/capabilities/*` package.
