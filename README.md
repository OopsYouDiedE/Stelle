# Stelle

Stelle 是一个围绕 `Core Mind + Cursor` 组织起来的本地运行时项目。

当前仓库已经收口到三条真实仍在使用的能力链路：

- `Inner Cursor`：默认内部上下文与连续性锚点
- `Discord Cursor`：Discord 消息接入、频道上下文维护、被动回复
- `Live Cursor`：Live2D 舞台、字幕、Kokoro TTS、可选 OBS 控制

仓库中旧的浏览器 Cursor、Minecraft 相关运行时和兼容占位代码已经从默认运行链路中清理掉。
这里的“浏览器”现在只保留本地 `Live Renderer` 页面，不再把“未登录的通用浏览器自动化”当成正式能力。

## 项目作用

Stelle 在运行时扮演一个协调器：

- `Core Mind` 决定当前附着到哪个 Cursor，以及允许调用哪些工具
- `Discord Cursor` 负责接收 Discord 消息并做频道级上下文维护
- `Live Cursor` 负责可见直播舞台行为，例如字幕、动作、语音播放
- `Live Renderer` 提供本地浏览器页面，供 OBS Browser Source 和调试使用
- `Kokoro` 通过本地 HTTP 服务提供中文 TTS

## 环境要求

### Node

- Node.js `20+`

### Python

- Python `3.11+` 推荐
- 本地虚拟环境 `.venv`

### 可选外部服务

- Discord Bot Token
- Gemini API Key
- OBS WebSocket v5
- Kokoro Python 依赖

## 安装方法

### 1. 安装 Node 依赖

```bash
npm install
```

### 2. 创建 Python 虚拟环境并安装 Kokoro 依赖

Windows PowerShell：

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements-kokoro.txt
```

### 3. 配置环境变量

```bash
copy .env.example .env
```

至少建议先填这些：

- `DISCORD_TOKEN`
- `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`
- `KOKORO_*`
- `LIVE_*`
- `OBS_*`（如果你要控制 OBS）

## 启动方式

### 完整运行时

启动内容包括：

- Live Renderer
- Discord Attached Core Mind
- 本地 Kokoro（如果启用自动启动）
- 调试页

开发模式：

```bash
npm run dev
```

构建并运行：

```bash
npm run build
npm run start
```

### 仅启动 Live Renderer

```bash
npm run dev:live
```

或

```bash
npm run start:live
```

### 仅启动 Discord Runtime

```bash
npm run dev:discord
```

或

```bash
npm run start:discord
```

### 仅启动 Kokoro

```bash
npm run start:kokoro
```

## 主要访问地址

默认 Live 页面：

```text
http://127.0.0.1:8787/live
```

默认调试页面：

```text
http://127.0.0.1:8787/_debug
```

默认 Kokoro 健康检查：

```text
http://127.0.0.1:8880/health
```

## 推荐默认配置

当前仓库推荐的默认运行方式是：

- `LIVE_TTS_OUTPUT=browser`
- `LIVE_TTS_STREAMING=true`
- `KOKORO_TTS_VOICE=zf_xiaobei`
- `KOKORO_TTS_LANGUAGE=z`
- `KOKORO_AUTO_START=true`

如果你是通过 OBS Browser Source 播放直播语音，`browser` 是当前最稳的默认值。

## 目录结构

```text
src/
  config/                  配置加载与归一化
  core/                    Core Mind、附着切换、上下文转移、工具调度
  cursors/
    discord/               Discord Cursor
    live/                  Live Cursor
  debug/                   运行时调试桥接
  discord/                 Discord runtime 与频道 session
  gemini/                  Gemini 文本提供器
  live/
    renderer/              本地 HTTP renderer 服务与前端
  runtime/                 启动辅助逻辑、Kokoro 启动检查
  stelle/                  Stelle 编排、路由、回复生成
  text/                    文本清洗与流式切句
  tools/
    live_tools/            live 相关工具按域分组
  tts/                     Gemini / Kokoro TTS provider

scripts/
  kokoro_tts_server.py     本地 Kokoro HTTP 服务

assets/
  live2d/                  Live2D 公共资源
```

## 设计理念

### 1. Core Mind 负责权限边界

`CoreMind` 是总协调器。它决定当前附着到哪个 Cursor，以及哪些动作应该走 Stelle 级权限，而不是直接从底层能力裸调用。

### 2. Cursor 负责环境边界

每个 Cursor 代表一个明确的运行时环境：

- `Inner Cursor`：内部连续性
- `Discord Cursor`：Discord 对话现场
- `Live Cursor`：直播舞台现场

### 3. Tool 只暴露真正应该被调用的动作

仓库已经做过一轮清理：

- 旧的浏览器兼容占位工具不再进入默认工具注册表
- 直接控嘴型、直接开关 lipsync 这类底层驱动能力不再公开暴露成通用 tool

### 4. 直播语音默认走浏览器播放

当前推荐链路：

1. Stelle 生成 `audio:stream`
2. Live Renderer 请求 Kokoro 流式音频
3. `/live` 页面直接消费并播放
4. 多页面情况下只有一个页面拥有音频播放权

## 下一步设计

- 下一阶段设计方案见 [docs/NextStepDesign.md](C:/Users/zznZZ/Stelle/docs/NextStepDesign.md)
- 这份设计明确了：
  - `Cursor` 只负责现场，不负责长期记忆落盘
  - 长期记忆先用 `md` 主存，不急着上 SQLite / 向量库
  - 浏览器和 Minecraft 只在真实会话存在时才允许成为正式能力
  - 直播内容未来优先从真实经历中取材

## 一条典型链路

### Discord 提及到直播语音

1. Discord 消息到达
2. `DiscordRouteDecider` 判断消息类型
3. `DiscordAttachedCoreMind` 选择处理路径
4. `DiscordLiveController` 生成或流式生成直播讲话内容
5. `live.stelle_stream_tts_caption` 推送字幕与 Kokoro 流式语音
6. `LiveRendererServer` 转发流式语音请求
7. `/live` 页面播放音频并更新舞台状态

## 调试说明

调试页可查看：

- 当前附着状态
- Cursor observation
- Tool 元数据
- Tool 调用面板
- Discord 本地 history
- Core decision history
- Tool audit history

这只是运行时调试界面，不是持久化后台。

## 常见问题

### 1. 中文字幕变成 `????`

这通常不是浏览器渲染问题，而是测试注入链路本身把中文变坏了。优先使用 UTF-8 明确的 Node/JSON 请求，不要靠不稳定的 shell 直塞中文。

### 2. 音频会重复播放好几遍

这通常意味着你同时开了多个 `/live` 页面。现在前端已经做了单实例音频主控，只有一个页面可以发声，其他页面会保持静默。

### 3. 浏览器自动播放被拦截

真实浏览器默认可能拦截自动播放。调试时需要：

- 使用允许 autoplay 的启动参数
- 或者先进行一次用户交互解锁音频

### 4. Kokoro 启动失败

运行时会先检查：

- `KOKORO_PYTHON`
- `KOKORO_SERVER_SCRIPT`

如果路径不存在，会直接报明确错误，而不是悄悄崩掉。

## 重要环境变量

### Discord

- `DISCORD_TOKEN`
- `DISCORD_TEST_CHANNEL_ID`
- `DISCORD_OWNER_USER_ID`

### Gemini

- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `AISTUDIO_API_KEY`
- `STELLE_PRIMARY_MODEL`
- `STELLE_SECONDARY_MODEL`

### Kokoro

- `KOKORO_TTS_BASE_URL`
- `KOKORO_TTS_VOICE`
- `KOKORO_TTS_LANGUAGE`
- `KOKORO_AUTO_START`
- `KOKORO_PYTHON`
- `KOKORO_SERVER_SCRIPT`

### Live / OBS

- `LIVE_RENDERER_HOST`
- `LIVE_RENDERER_PORT`
- `LIVE_TTS_ENABLED`
- `LIVE_TTS_OUTPUT`
- `LIVE_TTS_STREAMING`
- `OBS_CONTROL_ENABLED`
- `OBS_WEBSOCKET_URL`
- `OBS_WEBSOCKET_PASSWORD`

## 说明

- `dist/` 是构建产物，不要手改
- `.codex-chrome-live/` 和 `.codex-logs/` 是本地调试残留，已忽略
- `scripts/__pycache__/` 已忽略
- `config.yaml` 目前只保留给频道开关和后续 Discord 本地运行配置使用，不再承担按服务器切模型/API 的职责
- `config.yaml` 现在会持久化 Discord 频道启用状态、本服 bot 管理者，以及服务器内用户 ID 到本地绰号的映射

### Discord 服务器配置命令

以下命令建议在服务器频道里 `@bot` 使用：

- `允许本频道`
- `禁用本频道`
- `查看本服配置`
- `添加bot管理者 @某人`
- `移除bot管理者 @某人`

权限规则：

- bot 所有者由 `DISCORD_OWNER_USER_ID` 指定
- 服务器 `Administrator` 可以指定或移除本服 bot 管理者
- bot 所有者、本服 bot 管理者、服务器 `Administrator` 可以启用或禁用频道

## 最低验证标准

对结构性改动至少要重新执行：

```bash
npm run build
```

这是当前仓库最基本的自检门槛。
