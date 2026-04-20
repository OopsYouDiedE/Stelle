import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventDrivenSpeechCursor } from "./cursors/audio/SpeechCursor.js";
import type {
  SpeechEngine,
  SpeechSynthesisRequest,
  SpeechTranscriptionRequest,
} from "./cursors/audio/types.js";
import { getBrowserCursor } from "./cursors/browser/index.js";
import { getMinecraftCursor } from "./cursors/minecraft/index.js";
import { stelleMainLoop } from "./core/runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_WEB_PORT = Number(process.env.CURSOR_DEBUG_PORT ?? 3210);
const DEBUG_DISCORD_CHANNEL_ID =
  process.env.CURSOR_DEBUG_DISCORD_CHANNEL_ID ?? "debug-web";

let speechCursorSingleton: EventDrivenSpeechCursor | null = null;
let discordAppExports:
  | typeof import("./cursors/discord/app.js")
  | null = null;

const debugHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Stelle Cursor Debug</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --muted: #8b949e;
      --line: #30363d;
      --text: #e6edf3;
      --accent: #f78166;
      --accent-2: #58a6ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(247,129,102,0.18), transparent 32%),
        radial-gradient(circle at top right, rgba(88,166,255,0.16), transparent 30%),
        var(--bg);
    }
    .shell {
      max-width: 1320px;
      margin: 0 auto;
      padding: 28px;
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 20px;
    }
    .panel {
      background: rgba(22,27,34,0.92);
      border: 1px solid var(--line);
      border-radius: 18px;
      backdrop-filter: blur(8px);
      overflow: hidden;
    }
    .panel-head {
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .panel-body { padding: 16px 18px; }
    .cursor-list {
      display: grid;
      gap: 10px;
    }
    .cursor-item {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: rgba(13,17,23,0.7);
      cursor: pointer;
      transition: border-color .16s ease, transform .16s ease;
    }
    .cursor-item:hover,
    .cursor-item.active {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .cursor-item .kind {
      color: var(--accent-2);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .cursor-item .summary {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .stack { display: grid; gap: 16px; }
    .toolbar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    button {
      appearance: none;
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(247,129,102,0.18), rgba(247,129,102,0.08));
      color: var(--text);
      border-radius: 999px;
      padding: 10px 14px;
      cursor: pointer;
      font-weight: 600;
    }
    button.secondary {
      background: linear-gradient(180deg, rgba(88,166,255,0.16), rgba(88,166,255,0.06));
    }
    textarea, input, select {
      width: 100%;
      border: 1px solid var(--line);
      background: rgba(13,17,23,0.78);
      color: var(--text);
      border-radius: 12px;
      padding: 12px 14px;
      font: inherit;
    }
    textarea {
      min-height: 180px;
      resize: vertical;
      line-height: 1.45;
    }
    .hint {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 14px;
      background: rgba(13,17,23,0.92);
      border: 1px solid var(--line);
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
      font-size: 13px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(88,166,255,0.08);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 10px;
    }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel">
      <div class="panel-head">Cursor 列表</div>
      <div class="panel-body">
        <div class="status" id="app-status">正在连接调试接口</div>
        <div class="cursor-list" id="cursor-list"></div>
      </div>
    </section>
    <section class="stack">
      <div class="panel">
        <div class="panel-head">当前 Cursor</div>
        <div class="panel-body">
          <div class="toolbar">
            <button id="refresh-btn">刷新快照</button>
            <button class="secondary" id="tick-btn">Tick 当前 Cursor</button>
            <button class="secondary" id="reports-btn">拉取 Reports</button>
          </div>
          <div class="grid">
            <div>
              <div class="hint">内部上下文 / Snapshot</div>
              <pre id="snapshot-view">尚未选择 Cursor</pre>
            </div>
            <div>
              <div class="hint">最近 Reports</div>
              <pre id="reports-view">[]</pre>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">向 Cursor 下达指令</div>
        <div class="panel-body">
          <div class="hint" style="margin-bottom:12px;">
            支持两种方式：<br/>
            1. 文本命令：更像“发消息”<br/>
            2. JSON 请求：直接传给 Cursor 的 run/activate 层
          </div>
          <div class="grid">
            <div class="stack">
              <label class="hint">文本命令</label>
              <textarea id="text-command">inspect</textarea>
              <button id="send-text-btn">发送文本命令</button>
            </div>
            <div class="stack">
              <label class="hint">JSON 请求</label>
              <textarea id="json-command">{
  "mode": "run",
  "request": {
    "id": "debug-request",
    "action": { "type": "inspect_page" },
    "createdAt": 0
  }
}</textarea>
              <button class="secondary" id="send-json-btn">发送 JSON 请求</button>
            </div>
          </div>
          <div style="margin-top:16px;">
            <div class="hint">执行结果</div>
            <pre id="result-view">暂无结果</pre>
          </div>
        </div>
      </div>
    </section>
  </div>
  <script>
    const cursorListEl = document.getElementById("cursor-list");
    const snapshotView = document.getElementById("snapshot-view");
    const reportsView = document.getElementById("reports-view");
    const resultView = document.getElementById("result-view");
    const appStatus = document.getElementById("app-status");
    const textCommand = document.getElementById("text-command");
    const jsonCommand = document.getElementById("json-command");
    const refreshBtn = document.getElementById("refresh-btn");
    const tickBtn = document.getElementById("tick-btn");
    const reportsBtn = document.getElementById("reports-btn");
    const sendTextBtn = document.getElementById("send-text-btn");
    const sendJsonBtn = document.getElementById("send-json-btn");

    let selectedCursorId = null;
    let currentCursors = [];
    let textCommandDirty = false;
    let jsonCommandDirty = false;
    let lastCommandCursorId = null;

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    function compact(value, fallback = "无") {
      if (value === null || value === undefined || value === "") return fallback;
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function formatSnapshot(snapshot) {
      if (!snapshot || typeof snapshot !== "object") return pretty(snapshot);
      const lines = [];
      lines.push("摘要");
      lines.push("----");
      lines.push("cursor: " + compact(snapshot.cursorId));
      lines.push("kind: " + compact(snapshot.kind));
      lines.push("status: " + compact(snapshot.status));
      if ("summary" in snapshot) lines.push("summary: " + compact(snapshot.summary));
      if ("url" in snapshot) lines.push("url: " + compact(snapshot.url));
      if ("title" in snapshot) lines.push("title: " + compact(snapshot.title));
      if ("queueLength" in snapshot) lines.push("queueLength: " + compact(snapshot.queueLength));
      if ("knownChannelCount" in snapshot) lines.push("knownChannelCount: " + compact(snapshot.knownChannelCount));
      if ("channels" in snapshot && Array.isArray(snapshot.channels)) {
        lines.push("channels:");
        for (const channel of snapshot.channels.slice(0, 8)) {
          lines.push(
            "  - " +
              compact(channel.channelId) +
              " history=" +
              compact(channel.historySize, "0") +
              " focus=" +
              compact(channel.focus)
          );
        }
      }
      if ("lastObservation" in snapshot && snapshot.lastObservation) {
        lines.push("lastObservation: " + compact(snapshot.lastObservation));
      }
      lines.push("");
      lines.push("原始 JSON");
      lines.push("--------");
      lines.push(pretty(snapshot));
      return lines.join("\\n");
    }

    async function api(url, options) {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || response.statusText);
      return data;
    }

    function defaultTextCommand(cursor) {
      if (!cursor) return "inspect";
      switch (cursor.kind) {
        case "discord": return "你好，帮我总结一下当前上下文。";
        case "browser": return "inspect";
        case "minecraft": return "inspect";
        case "speech": return "你好，这是语音测试。";
        default: return "inspect";
      }
    }

    function defaultJsonCommand(cursor) {
      if (!cursor) return { mode: "tick" };
      const baseId = "debug-" + Date.now();
      switch (cursor.kind) {
        case "browser":
          return {
            mode: "run",
            request: {
              id: baseId,
              action: { type: "inspect_page" },
              createdAt: Date.now()
            }
          };
        case "minecraft":
          return {
            mode: "run",
            request: {
              id: baseId,
              action: { type: "inspect" },
              createdAt: Date.now()
            }
          };
        case "speech":
          return {
            mode: "activate",
            activation: {
              type: "speak_requested",
              reason: "web-debug",
              payload: {
                request: {
                  id: baseId,
                  text: "你好，这是网页调试请求。",
                  createdAt: Date.now(),
                  source: "web-debug"
                }
              },
              timestamp: Date.now()
            }
          };
        default:
          return { mode: "tick" };
      }
    }

    function renderCursorList() {
      cursorListEl.innerHTML = "";
      currentCursors.forEach((cursor) => {
        const div = document.createElement("div");
        div.className = "cursor-item" + (cursor.id === selectedCursorId ? " active" : "");
        div.innerHTML = \`
          <div class="kind">\${cursor.kind}</div>
          <div><strong>\${cursor.id}</strong></div>
          <div class="summary">\${cursor.summary || "无摘要"}</div>
        \`;
        div.onclick = () => selectCursor(cursor.id);
        cursorListEl.appendChild(div);
      });
    }

    async function loadCursors() {
      const data = await api("/api/cursors");
      currentCursors = data.cursors || [];
      if (!selectedCursorId && currentCursors.length) {
        selectedCursorId = currentCursors[0].id;
      }
      renderCursorList();
      if (selectedCursorId) {
        await loadSnapshot(selectedCursorId);
      }
      appStatus.textContent = "调试接口在线";
    }

    function resetCommandTemplates(cursorId) {
      const current = currentCursors.find((item) => item.id === cursorId);
      textCommand.value = defaultTextCommand(current);
      jsonCommand.value = pretty(defaultJsonCommand(current));
      textCommandDirty = false;
      jsonCommandDirty = false;
      lastCommandCursorId = cursorId;
    }

    async function loadSnapshot(cursorId, options = {}) {
      const data = await api("/api/cursors/" + encodeURIComponent(cursorId));
      snapshotView.textContent = formatSnapshot(data.snapshot);
      if (options.resetCommands || lastCommandCursorId !== cursorId) {
        resetCommandTemplates(cursorId);
      }
      renderCursorList();
    }

    async function loadReports() {
      const data = await api("/api/reports");
      reportsView.textContent = pretty(data.reports || []);
    }

    async function selectCursor(cursorId) {
      selectedCursorId = cursorId;
      await loadSnapshot(cursorId, { resetCommands: true });
    }

    textCommand.addEventListener("input", () => {
      textCommandDirty = true;
    });

    jsonCommand.addEventListener("input", () => {
      jsonCommandDirty = true;
    });

    refreshBtn.onclick = async () => {
      if (!selectedCursorId) return;
      await loadSnapshot(selectedCursorId);
    };

    tickBtn.onclick = async () => {
      if (!selectedCursorId) return;
      const data = await api("/api/cursors/" + encodeURIComponent(selectedCursorId) + "/tick", {
        method: "POST",
        body: JSON.stringify({})
      });
      resultView.textContent = pretty(data);
      await loadSnapshot(selectedCursorId);
    };

    reportsBtn.onclick = async () => {
      await loadReports();
    };

    sendTextBtn.onclick = async () => {
      if (!selectedCursorId) return;
      const data = await api("/api/cursors/" + encodeURIComponent(selectedCursorId) + "/command", {
        method: "POST",
        body: JSON.stringify({ text: textCommand.value })
      });
      resultView.textContent = pretty(data);
      await loadSnapshot(selectedCursorId);
    };

    sendJsonBtn.onclick = async () => {
      if (!selectedCursorId) return;
      const parsed = JSON.parse(jsonCommand.value);
      const data = await api("/api/cursors/" + encodeURIComponent(selectedCursorId) + "/command", {
        method: "POST",
        body: JSON.stringify(parsed)
      });
      resultView.textContent = pretty(data);
      await loadSnapshot(selectedCursorId);
    };

    loadCursors().catch((error) => {
      appStatus.textContent = "调试接口加载失败: " + error.message;
      resultView.textContent = String(error.stack || error.message || error);
    });
    setInterval(() => {
      if (selectedCursorId) {
        loadSnapshot(selectedCursorId, { resetCommands: false }).catch(() => {});
      }
    }, 5000);
  </script>
</body>
</html>`;

class MockSpeechEngine implements SpeechEngine {
  async transcribe(
    request: SpeechTranscriptionRequest
  ) {
    return {
      requestId: request.id,
      ok: true,
      text: `[mock transcription] ${request.audio.path}`,
      language: request.language ?? "unknown",
      durationMs: request.audio.durationMs,
      summary: `Mock transcribed ${request.audio.path}.`,
      timestamp: Date.now(),
    };
  }

  async synthesize(
    request: SpeechSynthesisRequest
  ) {
    const dir = path.join(process.cwd(), "artifacts", "speech");
    await mkdir(dir, { recursive: true });
    const outputPath = path.join(dir, `${request.id}.txt`);
    await writeFile(outputPath, request.text, "utf8");
    return {
      requestId: request.id,
      ok: true,
      audioPath: outputPath,
      summary: `Mock synthesized speech for ${request.id}.`,
      timestamp: Date.now(),
    };
  }
}

function getSpeechCursor(): EventDrivenSpeechCursor {
  if (!speechCursorSingleton) {
    speechCursorSingleton = new EventDrivenSpeechCursor({
      id: "speech-main",
      engine: new MockSpeechEngine(),
    });
    stelleMainLoop.registerCursor(speechCursorSingleton);
  }
  return speechCursorSingleton;
}

async function ensureDebugCursors(): Promise<void> {
  getBrowserCursor();
  getMinecraftCursor();
  getSpeechCursor();
}

async function loadDiscordApp(): Promise<void> {
  try {
    discordAppExports = await import("./cursors/discord/app.js");
  } catch (error) {
    console.error("[CursorDebug] Discord app bootstrap failed:", error);
  }
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeCommandResult(result: unknown): unknown {
  return result === undefined ? { ok: true } : result;
}

async function listCursorSnapshots(): Promise<unknown[]> {
  const snapshot = await stelleMainLoop.snapshot();
  const cursors = await Promise.all(
    snapshot.registeredCursorIds.map(async (cursorId) => {
      const rawSnapshot = await stelleMainLoop.snapshotCursor(cursorId);
      const host = stelleMainLoop.getCursor(cursorId);
      return {
        id: cursorId,
        kind: host?.kind ?? "unknown",
        summary:
          typeof rawSnapshot === "object" &&
          rawSnapshot !== null &&
          "summary" in rawSnapshot
            ? (rawSnapshot as { summary?: string }).summary ?? ""
            : "",
        snapshot: rawSnapshot,
      };
    })
  );
  return cursors;
}

function parseBrowserTextCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "inspect") {
    return { type: "inspect_page" } as const;
  }
  if (trimmed === "interactive") {
    return { type: "inspect_interactive", input: { maxItems: 16 } } as const;
  }
  if (trimmed === "back") {
    return { type: "back" } as const;
  }
  if (trimmed === "refresh") {
    return { type: "refresh" } as const;
  }
  if (trimmed.startsWith("open ")) {
    return { type: "open", input: { url: trimmed.slice(5).trim() } } as const;
  }
  if (trimmed.startsWith("click ")) {
    return { type: "click", input: { text: trimmed.slice(6).trim() } } as const;
  }
  if (trimmed.startsWith("type ")) {
    const [, target, value] = trimmed.match(/^type\s+(.+?)\s*\|\s*(.+)$/i) ?? [];
    if (target && value) {
      return {
        type: "type",
        input: { placeholder: target.trim(), text: value.trim() },
      } as const;
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { type: "open", input: { url: trimmed } } as const;
  }
  return { type: "inspect_page" } as const;
}

function parseMinecraftTextCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "inspect") {
    return { type: "inspect" } as const;
  }
  if (trimmed === "stop") {
    return { type: "stop" } as const;
  }
  if (trimmed.startsWith("say ")) {
    return { type: "chat", input: { message: trimmed.slice(4).trim() } } as const;
  }
  const gotoMatch = trimmed.match(/^goto\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?$/i);
  if (gotoMatch) {
    return {
      type: "goto",
      input: {
        x: Number(gotoMatch[1]),
        y: Number(gotoMatch[2]),
        z: Number(gotoMatch[3]),
        range: gotoMatch[4] ? Number(gotoMatch[4]) : 1,
      },
    } as const;
  }
  const followMatch = trimmed.match(/^follow\s+(.+?)(?:\s+(\d+(?:\.\d+)?))?$/i);
  if (followMatch) {
    return {
      type: "follow_player",
      input: {
        username: followMatch[1].trim(),
        range: followMatch[2] ? Number(followMatch[2]) : 2,
      },
    } as const;
  }
  return { type: "inspect" } as const;
}

async function handleCursorCommand(cursorId: string, body: any): Promise<unknown> {
  const cursor = stelleMainLoop.getCursor(cursorId) as any;
  if (!cursor) {
    throw new Error(`Cursor "${cursorId}" is not registered.`);
  }

  if (typeof body?.text === "string") {
    const text = body.text.trim();
    if (cursor.kind === "discord") {
      if (!discordAppExports) {
        throw new Error("Discord app is not available.");
      }
      return discordAppExports.discordController.debugMessage(
        DEBUG_DISCORD_CHANNEL_ID,
        text,
        {
          authorId: "debug-web-user",
          nickname: "[WebDebug]",
          runMain: true,
        }
      );
    }

    if (cursor.kind === "browser") {
      return cursor.run({
        id: `browser-web-${Date.now()}`,
        action: parseBrowserTextCommand(text),
        createdAt: Date.now(),
      });
    }

    if (cursor.kind === "minecraft") {
      return cursor.run({
        id: `minecraft-web-${Date.now()}`,
        action: parseMinecraftTextCommand(text),
        createdAt: Date.now(),
      });
    }

    if (cursor.kind === "speech") {
      await cursor.activate({
        type: "speak_requested",
        reason: "web-debug text command",
        payload: {
          request: {
            id: `speech-web-${Date.now()}`,
            text,
            createdAt: Date.now(),
            source: "web-debug",
          },
        },
        timestamp: Date.now(),
      });
      return {
        ok: true,
        summary: "Speech text command queued.",
        reports: await cursor.tick(),
      };
    }
  }

  if (body?.mode === "tick") {
    return {
      ok: true,
      reports: await stelleMainLoop.tickCursor(cursorId),
    };
  }

  if (body?.mode === "activate") {
    const activation = {
      ...body.activation,
      timestamp: body.activation?.timestamp ?? Date.now(),
      reason: body.activation?.reason ?? "web-debug activation",
    };
    await stelleMainLoop.activateCursor(cursorId, activation);
    return {
      ok: true,
      reports: await stelleMainLoop.tickCursor(cursorId),
    };
  }

  if (body?.mode === "run") {
    if (typeof cursor.run !== "function") {
      throw new Error(`Cursor "${cursorId}" does not support run().`);
    }
    const request = {
      ...body.request,
      id: body.request?.id ?? `web-run-${Date.now()}`,
      createdAt: body.request?.createdAt || Date.now(),
    };
    return cursor.run(request);
  }

  throw new Error("Unsupported command body.");
}

await loadDiscordApp();
await ensureDebugCursors();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(debugHtml);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cursors") {
      const cursors = await listCursorSnapshots();
      sendJson(res, 200, { ok: true, cursors });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/reports") {
      sendJson(res, 200, { ok: true, reports: stelleMainLoop.drainReports() });
      return;
    }

    const cursorMatch = url.pathname.match(/^\/api\/cursors\/([^/]+)$/);
    if (req.method === "GET" && cursorMatch) {
      const cursorId = decodeURIComponent(cursorMatch[1]);
      const snapshot = await stelleMainLoop.snapshotCursor(cursorId);
      sendJson(res, 200, { ok: true, cursorId, snapshot });
      return;
    }

    const tickMatch = url.pathname.match(/^\/api\/cursors\/([^/]+)\/tick$/);
    if (req.method === "POST" && tickMatch) {
      const cursorId = decodeURIComponent(tickMatch[1]);
      sendJson(res, 200, {
        ok: true,
        cursorId,
        reports: await stelleMainLoop.tickCursor(cursorId),
      });
      return;
    }

    const commandMatch = url.pathname.match(/^\/api\/cursors\/([^/]+)\/command$/);
    if (req.method === "POST" && commandMatch) {
      const cursorId = decodeURIComponent(commandMatch[1]);
      const body = await readJson(req);
      const result = await handleCursorCommand(cursorId, body);
      sendJson(res, 200, {
        ok: true,
        cursorId,
        result: normalizeCommandResult(result),
        snapshot: await stelleMainLoop.snapshotCursor(cursorId),
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}).listen(DEBUG_WEB_PORT, () => {
  console.log(
    `[CursorDebug] Web panel ready at http://127.0.0.1:${DEBUG_WEB_PORT} (src: ${__dirname})`
  );
});
