# Stelle

Stelle 是一个本地运行时项目，围绕 `Core Mind + Cursor + Tools + Live Renderer + Memory` 组织。

当前代码结构已经按下面这几个原则收敛过一轮：

- Discord 和 live 是两个不同环境，不再强行揉成一个上下文。
- 路由先看硬编码规则，再把剩余判断交给模型。
- 硬编码规则可以基于明确规则词或结构特征。
- Prompt 不再内嵌在 TS 文件里，统一外提到 `prompts/`。
- 调试日志、浏览器 profile、临时评测产物不再作为仓库文档保留。

## 运行方式

安装依赖：

```bash
npm install
```

开发：

```bash
npm run dev
npm run dev:discord
npm run dev:live
```

构建与运行：

```bash
npm run build
npm run start
npm run start:discord
npm run start:live
```

本地 Kokoro TTS 服务：

```bash
npm run start:kokoro
```

## 启动入口

统一入口：

- `src/start.ts`

支持三种模式：

- `runtime`：完整运行时
- `discord`：只启动 Discord 主链
- `live`：只启动 live renderer

对应脚本：

- `npm run dev` / `npm run dev:runtime` -> `tsx watch src/start.ts runtime`
- `npm run dev:discord` -> `tsx src/start.ts discord`
- `npm run dev:live` -> `tsx src/start.ts live`
- `npm run start` -> `node dist/start.js runtime`
- `npm run start:discord` -> `node dist/start.js discord`
- `npm run start:live` -> `node dist/start.js live`

## 路由原则

### Discord

`src/stelle/DiscordAttachedCoreMind.ts` 当前采用两层路由：

1. 硬编码规则
   只处理必须明确拦截的情况，比如高风险请求、live/OBS 控制、定向社交动作、自我/系统问题、明确的记忆连续性操作。
2. AI 路由
   剩余普通消息交给模型判断是走 `cursor` 还是走 `stelle`。

Discord 前台回复本身还带一个小型工具循环：

- 模型自己决定直接回复，还是先调用 `search.cursor_web_search`
- 如有必要，再调用 `search.cursor_web_read`
- 最多循环 3 轮，再产出最终回复

也就是说：

- 不再用关键词直接决定“要不要搜”
- 关键词类规则只保留在硬编码规则层

### Live

`src/stelle/LiveContentController.ts` 也是两层：

1. 硬编码规则
   处理高风险、敏感内容、社交点名、明确的记忆叙事请求。
2. AI 路由
   剩余 live 请求由模型决定：
   - 走本地轻量脚本 `local`
   - 走 Stelle 生成 `stelle`

## Prompt 外置

所有当前模型实际使用的 Prompt 都已经外提到 `prompts/`。

格式统一为：

1. 上半部分写 `Variables`
2. 标出可用变量名和含义
3. 下半部分写 `Body`
4. 运行时用 `{{variable_name}}` 替换

当前 prompt 目录：

```text
prompts/
|-- discord/
|   |-- core_reply.md
|   |-- cursor_reply.md
|   |-- cursor_tool_loop.md
|   |-- judge.md
|   |-- route_decider.md
|   `-- social_reply.md
`-- live/
    |-- route_decider.md
    `-- script.md
```

运行时加载器：

- `src/PromptTemplates.ts`

## 当前目录结构

```text
.
|-- assets/
|   `-- live2d/
|-- docs/
|   |-- LiveArchitecture.md
|   |-- NextStepDesign.md
|   `-- personality_prompt/
|       |-- 00_data_collection.md
|       |-- 01_baseline_style_profiles.md
|       |-- 02_rubric_and_target_ranges.md
|       |-- 03_prompt_core.md
|       |-- 04_test_cases.md
|       |-- 05_evaluation_and_revision_log.md
|       |-- 06_final_prompt.md
|       |-- 10_real_chat_interjection_cases.md
|       `-- README.md
|-- memory/
|   |-- channels/
|   |-- experiences/
|   |-- guilds/
|   |-- people/
|   |-- relationships/
|   |-- summaries/
|   `-- README.md
|-- prompts/
|   |-- discord/
|   `-- live/
|-- scripts/
|-- src/
|   |-- CoreMind.ts
|   |-- DiscordRuntime.ts
|   |-- index.ts
|   |-- KokoroTtsProvider.ts
|   |-- MemoryManager.ts
|   |-- PromptTemplates.ts
|   |-- start.ts
|   |-- StelleConfig.ts
|   |-- TextStream.ts
|   |-- types.ts
|   |-- cursors/
|   |   |-- BaseCursor.ts
|   |   |-- DiscordCursor.ts
|   |   `-- LiveCursor.ts
|   |-- live/
|   |   |-- LiveRuntime.ts
|   |   `-- renderer/
|   |       |-- LiveRendererServer.ts
|   |       |-- renderDebugHtml.ts
|   |       |-- renderLiveHtml.ts
|   |       `-- client/
|   |           |-- vite.config.ts
|   |           `-- src/
|   |               |-- audioShared.ts
|   |               |-- live2dRuntime.ts
|   |               `-- main.ts
|   |-- stelle/
|   |   |-- DiscordAttachedCoreMind.ts
|   |   `-- LiveContentController.ts
|   `-- tools/
|       |-- discord.ts
|       |-- index.ts
|       `-- live.ts
|-- config.yaml
|-- package.json
`-- tsconfig.json
```

说明：

- `artifacts/` 属于运行时生成物，已从仓库工作文档中清走，并通过 `.gitignore` 忽略。
- `docs/personality_prompt/` 只保留当前仍有参考价值的正式材料；旧测试跑批、候选 prompt 和临时快照已移除。

## `src/` 结构说明

### 根层

- `src/start.ts`
  统一启动入口，负责 runtime / discord / live 三种模式。

- `src/CoreMind.ts`
  Core Mind 本体，负责 cursor 注册、附着切换、上下文转移、tool 接入和连续性状态。

- `src/DiscordRuntime.ts`
  Discord.js 运行时封装、消息摘要、频道 session、连接状态。

- `src/MemoryManager.ts`
  长期记忆管理、落盘、整理、摘要、recall。

- `src/KokoroTtsProvider.ts`
  TTS 提供层。

- `src/StelleConfig.ts`
  模型配置、运行时配置、Discord 配置存取。

- `src/TextStream.ts`
  文本流处理、清洗、句段切分，以及 `GeminiTextProvider`。

- `src/PromptTemplates.ts`
  外部 prompt 模板加载与变量渲染。

- `src/types.ts`
  共享运行时类型。

- `src/index.ts`
  对外导出聚合入口。

### Cursor 层

- `src/cursors/BaseCursor.ts`
  基础 cursor 抽象，以及默认 `InnerCursor`。

- `src/cursors/DiscordCursor.ts`
  Discord 现场上下文、被动回复边界、只读搜索工具暴露。

- `src/cursors/LiveCursor.ts`
  直播语境、发言队列、live 输出桥接。

### Stelle 主链

- `src/stelle/DiscordAttachedCoreMind.ts`
  Discord 主链入口，负责治理命令、AI 路由、judge、回复生成、工具循环、memory 记录。

- `src/stelle/LiveContentController.ts`
  Live 主链入口，负责 live 路由、文案生成、字幕/TTS 输出协调。

### Tools

- `src/tools/index.ts`
  通用 tool registry、memory/search/tts 等通用工具。

- `src/tools/discord.ts`
  Discord 专属工具。

- `src/tools/live.ts`
  Live 专属工具。

### Live Renderer

- `src/live/LiveRuntime.ts`
  Live 运行时主文件。

- `src/live/renderer/LiveRendererServer.ts`
  Renderer 服务端主文件，包含 HTTP 服务、debug API、HTTP bridge 以及服务端辅助逻辑。

- `src/live/renderer/renderLiveHtml.ts`
  live 页面 HTML 输出。

- `src/live/renderer/renderDebugHtml.ts`
  debug 页面 HTML 输出。

- `src/live/renderer/client/src/main.ts`
  浏览器端入口。

- `src/live/renderer/client/src/live2dRuntime.ts`
  浏览器端 Live2D 运行时。

- `src/live/renderer/client/src/audioShared.ts`
  浏览器端音频共享逻辑。

## 当前实际模型 Prompt 来源

### Discord

- `discord/core_reply`
- `discord/cursor_reply`
- `discord/cursor_tool_loop`
- `discord/judge`
- `discord/route_decider`
- `discord/social_reply`

### Live

- `live/route_decider`
- `live/script`

## 验证

结构或 Prompt 改动后，至少执行：

```bash
npm run build
```

更严格的检查：

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
```
