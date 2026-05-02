# Stelle Project Conventions

这份文档是项目日常修改规范。架构合同见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，测试规范见 [`TESTING.md`](TESTING.md)。

## Formatting

- 使用 Prettier 统一格式。
- 提交前运行 `npm run format:check`。
- 需要批量格式化时运行 `npm run format`。
- Prettier 覆盖源码、测试、脚本、文档和配置；排除 `dist/`、`node_modules/`、`memory/`、`data/`、`evals/logs/`、vendor 和本地密钥。

## TypeScript

- TypeScript 使用 ESM，源文件 import 需要写 `.js` 后缀。
- 优先使用明确类型、Zod schema 和现有 helper，不用临时字符串解析替代结构化接口。
- 公共入口移动时同步更新所有调用方和测试，不为旧结构留下临时 re-export。
- 不绕过 `src/capabilities/tooling/tool_registry.ts` 和 owner package 的工具注册入口。

## Module Boundaries

- 跨 package 通信用 `StelleEventBus`、Core protocol、DataPlane 和 package service contract。
- Capability 不 import 具体 Window；Window 不重写可复用能力逻辑。
- Stage 输出必须经过 `src/capabilities/expression/stage_output`。
- 设备动作必须经过 `src/capabilities/action/device_action`。
- 工具调用必须经过 `ToolRegistry`，不要直接调用 provider 实现绕过权限与审计。
- Renderer server 负责 HTTP/socket/control glue，不承载高层业务决策。

## Comments

- 只在关键边界补注释：模块入口、复杂状态机、权限检查、恢复逻辑、非显然 fallback。
- 不给每个函数机械加 JSDoc。
- 注释说明“为什么这样做”或“边界是什么”，避免复述代码。

## Security

- `.env` 保存密钥，不提交真实 token。
- Debug 和 control 路由默认必须 token 保护，不能暴露到公网。
- 公共 URL 读取必须经过 SSRF 校验。
- 外部可见输出需要经过 Arbiter 或 ToolRegistry 权限层。
- 文件系统工具必须限制在 workspace 内。

## Memory

- recent memory 是事实日志，long-term memory 是被压缩或审核后的长期资料。
- 不把一次性噪声、重复关键词或未经确认的猜测直接写入长期记忆。
- 记忆检索不能只靠单一关键词命中；必须考虑覆盖率、短语、上下文和来源。
- 记忆生成、审批和检索规则见 [`MEMORY_GENERATION.md`](MEMORY_GENERATION.md)。

## Documentation

- README 只放启动和配置入口。
- `docs/STRUCTURE.md` 说明结构。
- `docs/PROJECT_CONVENTIONS.md` 说明项目规范。
- `docs/TESTING.md` 说明测试规范。
- `docs/MEMORY_GENERATION.md` 说明记忆生成和抗偏规则。
- 结构变更后同步更新相关文档链接。
