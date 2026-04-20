import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import YAML from "yaml";
import "dotenv/config";
import type {
  BrowserAction,
  BrowserRunRequest,
  BrowserRunResult,
  BrowserScreenshotResult,
  BrowserSnapshot,
} from "./cursors/browser/index.js";
import { getBrowserCursor } from "./cursors/browser/index.js";
import { getBrowserPage } from "./cursors/browser/session.js";

const DEBUG_WEB_PORT = Number(process.env.CURSOR_DEBUG_PORT ?? 3210);

interface BrowserPlanStep {
  goal: string;
  action?: BrowserAction;
  wait?: BrowserRunRequest["wait"];
  expect?: BrowserRunRequest["expect"];
  dynamic?:
    | {
        type: "click_first_bilibili_video_title_containing";
        keyword: string;
      };
}

interface PlannerConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

interface BrowserStepPayload {
  index: number;
  total: number;
  goal: string;
  action: BrowserAction;
  result: BrowserRunResult;
  snapshot: BrowserSnapshot;
  screenshot: (BrowserScreenshotResult & { webUrl: string | null }) | null;
}

const debugHtml = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Browser Cursor Executor</title>
  <style>
    :root {
      --bg: #0f171f;
      --panel: rgba(17, 26, 35, 0.94);
      --panel-2: rgba(5, 10, 15, 0.66);
      --line: rgba(174, 196, 214, 0.22);
      --text: #eef6fd;
      --muted: #9dadba;
      --accent: #f7b267;
      --accent-2: #78d5ff;
      --ok: #54d58a;
      --bad: #ff7171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 14% 0%, rgba(247, 178, 103, 0.24), transparent 34%),
        radial-gradient(circle at 90% 8%, rgba(120, 213, 255, 0.18), transparent 34%),
        linear-gradient(135deg, #0f171f, #090f15 56%, #131c24);
    }
    .shell {
      max-width: 1500px;
      margin: 0 auto;
      padding: 22px;
      display: grid;
      grid-template-columns: minmax(340px, 480px) 1fr;
      gap: 18px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 22px;
      background: var(--panel);
      box-shadow: 0 22px 72px rgba(0, 0, 0, 0.28);
      overflow: hidden;
    }
    .panel-head {
      padding: 15px 17px;
      border-bottom: 1px solid var(--line);
      font-weight: 900;
      letter-spacing: 0.04em;
    }
    .panel-body {
      padding: 17px;
      display: grid;
      gap: 14px;
    }
    textarea, pre {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 15px;
      color: var(--text);
      background: rgba(4, 9, 14, 0.78);
      padding: 13px;
      font-family: "Cascadia Code", Consolas, "Microsoft YaHei", monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    textarea {
      min-height: 130px;
      resize: vertical;
      outline: none;
    }
    pre {
      margin: 0;
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 12px 16px;
      color: #201307;
      background: linear-gradient(135deg, var(--accent), #ffd48d);
      font-weight: 900;
      cursor: pointer;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.58;
    }
    .hint, .status {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--muted);
    }
    .dot.ok { background: var(--ok); }
    .dot.bad { background: var(--bad); }
    .steps {
      display: grid;
      gap: 16px;
    }
    .step {
      border: 1px solid var(--line);
      border-radius: 20px;
      background: var(--panel-2);
      overflow: hidden;
    }
    .step-head {
      display: grid;
      gap: 6px;
      padding: 13px 15px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
    }
    .step.ok .step-head { border-left: 5px solid var(--ok); }
    .step.fail .step-head { border-left: 5px solid var(--bad); }
    .step img {
      display: block;
      width: 100%;
      max-height: 760px;
      object-fit: contain;
      background: white;
    }
    .empty {
      min-height: 360px;
      display: grid;
      place-items: center;
      padding: 30px;
      color: var(--muted);
      text-align: center;
      border: 1px dashed var(--line);
      border-radius: 20px;
      background: rgba(4, 9, 14, 0.38);
    }
    code { color: #ffd48d; }
    @media (max-width: 1000px) {
      .shell { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel">
      <div class="panel-head">Browser Command Executor</div>
      <div class="panel-body">
        <div class="status"><span class="dot" id="status-dot"></span><span id="status-text">等待命令</span></div>
        <div class="hint">
          输入自然命令，后端执行器会拆成多步 Browser action。每步执行完都会立刻把截图推回这里。示例：
          <code>打开bilibili</code>，<code>打开 https://example.com</code>，<code>点击 Learn more</code>，
          <code>输入 input[name=q] | 三月七</code>。
        </div>
        <textarea id="command-input">打开bilibili，搜索 三月七，然后点击标题含有三月七的第一个视频。</textarea>
        <button id="run-btn">执行命令</button>
        <pre id="log-view">尚未执行。</pre>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">Step Frames</div>
      <div class="panel-body">
        <div id="steps" class="steps">
          <div class="empty">每一步执行后的 Playwright 画面会显示在这里。没有轮询，没有额外截图按钮。</div>
        </div>
      </div>
    </section>
  </div>

  <script>
    const runBtn = document.getElementById("run-btn");
    const commandInput = document.getElementById("command-input");
    const steps = document.getElementById("steps");
    const logView = document.getElementById("log-view");
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function setStatus(ok, text) {
      statusDot.className = "dot " + (ok ? "ok" : "bad");
      statusText.textContent = text;
    }

    function appendStep(step) {
      const card = document.createElement("div");
      card.className = "step " + (step.result?.ok ? "ok" : "fail");
      const shotUrl = step.screenshot?.webUrl
        ? step.screenshot.webUrl + (step.screenshot.webUrl.includes("?") ? "&" : "?") + "t=" + Date.now()
        : "";
      card.innerHTML =
        '<div class="step-head">' +
        '<div><strong>Step:</strong> ' + escapeHtml(step.index + " / " + step.total) + '</div>' +
        '<div><strong>目标:</strong> ' + escapeHtml(step.goal) + '</div>' +
        '<div><strong>操作:</strong> ' + escapeHtml(step.result?.summary || step.action?.type || "-") + '</div>' +
        '<div><strong>是否成功:</strong> ' + escapeHtml(String(Boolean(step.result?.ok))) + '</div>' +
        '<div><strong>LLM:</strong> 未运行</div>' +
        '<div><strong>URL:</strong> ' + escapeHtml(step.snapshot?.url || "-") + '</div>' +
        '<div><strong>Title:</strong> ' + escapeHtml(step.snapshot?.title || "-") + '</div>' +
        '</div>' +
        (shotUrl ? '<img alt="Browser step frame" src="' + escapeHtml(shotUrl) + '" />' : "");
      steps.appendChild(card);
      card.scrollIntoView({ behavior: "smooth", block: "end" });
    }

    async function runCommand() {
      runBtn.disabled = true;
      steps.innerHTML = "";
      logView.textContent = "";
      setStatus(true, "执行中...");

      try {
        const response = await fetch("/api/browser/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: commandInput.value }),
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || response.statusText);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalOk = true;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            logView.textContent += pretty(event) + "\n\n";
            if (event.type === "step") {
              appendStep(event.step);
              finalOk = finalOk && Boolean(event.step?.result?.ok);
              setStatus(Boolean(event.step?.result?.ok), event.step?.result?.summary || "步骤完成");
            } else if (event.type === "done") {
              setStatus(finalOk, event.summary || "执行完成");
            } else if (event.type === "error") {
              finalOk = false;
              setStatus(false, event.error || "执行失败");
            }
          }
        }
      } catch (error) {
        setStatus(false, error.message);
        logView.textContent += String(error.stack || error.message || error);
      } finally {
        runBtn.disabled = false;
      }
    }

    runBtn.onclick = runCommand;
  </script>
</body>
</html>`;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function artifactUrlFromPath(filePath: string): string | null {
  const artifactsRoot = path.resolve(process.cwd(), "artifacts");
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(artifactsRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return `/artifacts/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function getStaticContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function loadPlannerConfig(): PlannerConfig {
  let config: any = {};
  try {
    config = YAML.parse(readFileSync(path.resolve(process.cwd(), "config.yaml"), "utf8")) ?? {};
  } catch {
    config = {};
  }

  const firstGuild = config.guilds && typeof config.guilds === "object"
    ? Object.values(config.guilds)[0] as any
    : undefined;

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    firstGuild?.api_key;
  if (!apiKey) {
    throw new Error("Missing LLM API key. Set GEMINI_API_KEY, OPENAI_API_KEY, or config.yaml guild api_key.");
  }

  return {
    apiKey,
    baseURL:
      process.env.OPENAI_BASE_URL ||
      process.env.BASE_URL ||
      firstGuild?.base_url ||
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    model:
      process.env.OPENAI_MODEL ||
      process.env.MODEL ||
      firstGuild?.model ||
      "gemma-4-31b-it",
  };
}

function createPlannerClient(): { client: OpenAI; model: string } {
  const config = loadPlannerConfig();
  return {
    client: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }),
    model: config.model,
  };
}

function parsePlannerJson(text: string): BrowserPlanStep[] {
  let cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .trim();

  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const objectStart = cleaned.indexOf("{");
    const arrayStart = cleaned.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    if (starts.length) {
      cleaned = cleaned.slice(Math.min(...starts));
    }
  }

  const objectEnd = cleaned.lastIndexOf("}");
  const arrayEnd = cleaned.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);
  if (end >= 0) {
    cleaned = cleaned.slice(0, end + 1);
  }

  const parsed = JSON.parse(cleaned) as { steps?: BrowserPlanStep[] } | BrowserPlanStep[];
  const steps = Array.isArray(parsed) ? parsed : parsed.steps;
  if (!Array.isArray(steps) || !steps.length) {
    throw new Error("Planner returned no steps.");
  }
  return steps.map((step, index) => {
    if (!step.goal || typeof step.goal !== "string") {
      throw new Error(`Planner step ${index + 1} is missing goal.`);
    }
    if (!step.action && !step.dynamic) {
      throw new Error(`Planner step ${index + 1} has neither action nor dynamic.`);
    }
    return step;
  });
}

function buildPlannerPrompt(command: string, snapshot: BrowserSnapshot): string {
  return [
    "You are the Browser Cursor Judge/Planner for Stelle.",
    "Route: internal browser context/history -> Judge plan -> Executor.",
    "Your job is only to produce a JSON plan. Do not explain. Do not use markdown.",
    "Each step must include goal and exactly one of action or dynamic.",
    "Prefer robust direct navigation for search pages when it is semantically equivalent.",
    "For Bilibili video search, prefer opening https://search.bilibili.com/video?keyword=<encoded keyword> instead of typing into the homepage search box.",
    "When the user asks to click the first video whose title contains some text, use dynamic.type click_first_bilibili_video_title_containing with keyword.",
    "When DOM selectors are uncertain or the site resists automation, use visual real-operation actions: mouse_click by viewport coordinate, keyboard_type into the focused field, and keyboard_press for keys.",
    "If a page requires human login/captcha/verification, add a human_wait action for 30000-60000ms, then inspect or continue.",
    "Use waits around 30000-60000ms for human-visible browser operations. If a wait times out, the executor reports it and the next step can continue if still useful.",
    "For each concrete action, include wait and expect when useful. The BrowserCursor also has its own Browser Judge for final validation/defaults.",
    "Allowed action JSON:",
    JSON.stringify({
      open: { type: "open", input: { url: "https://example.com" } },
      click: { type: "click", input: { selector: "a[href*=BV...]", text: "visible text", timeoutMs: 20000 } },
      type: { type: "type", input: { selector: "input[name=q]", text: "hello", pressEnter: true, timeoutMs: 20000 } },
      mouse_click: { type: "mouse_click", input: { x: 320, y: 240, button: "left", clickCount: 1 } },
      keyboard_type: { type: "keyboard_type", input: { text: "hello", delayMs: 20 } },
      keyboard_press: { type: "keyboard_press", input: { key: "Enter" } },
      human_wait: { type: "human_wait", input: { reason: "captcha or login", timeoutMs: 45000 } },
      inspect_page: { type: "inspect_page" },
      inspect_interactive: { type: "inspect_interactive", input: { maxItems: 20 } },
      back: { type: "back" },
      refresh: { type: "refresh" },
    }),
    "Allowed dynamic JSON:",
    JSON.stringify({
      type: "click_first_bilibili_video_title_containing",
      keyword: "\u4e09\u6708\u4e03",
    }),
    "Output shape:",
    JSON.stringify({
      steps: [
        {
          goal: "Open Bilibili home page",
          action: { type: "open", input: { url: "https://www.bilibili.com" } },
          wait: { type: "network_idle", timeoutMs: 30000 },
          expect: { summary: "Bilibili page loads", mode: "one_of", conditions: [{ type: "title_changed" }, { type: "url_changed" }], onMiss: "report" },
        },
      ],
    }),
    "Current Browser snapshot:",
    JSON.stringify({ url: snapshot.url, title: snapshot.title, summary: snapshot.summary }),
    "User command:",
    command,
  ].join("\n");
}

async function judgeBrowserCommand(command: string): Promise<BrowserPlanStep[]> {
  const cursor = getBrowserCursor();
  const snapshot = await cursor.snapshot();
  const { client, model } = createPlannerClient();
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: "You are a strict JSON Browser Judge. Return only JSON with a steps array.",
      },
      { role: "user", content: buildPlannerPrompt(command, snapshot) },
    ],
  });
  const content = response.choices[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Planner returned an empty response.");
  return parsePlannerJson(content);
}

async function resolveDynamicAction(step: BrowserPlanStep): Promise<BrowserAction> {
  if (!step.dynamic) {
    if (!step.action) throw new Error(`Step has no action: ${step.goal}`);
    return step.action;
  }

  if (step.dynamic.type === "click_first_bilibili_video_title_containing") {
    const selector = await findFirstBilibiliVideoSelector(step.dynamic.keyword);
    return { type: "click", input: { selector, timeoutMs: 20000 } };
  }

  throw new Error(`Unsupported dynamic browser step: ${(step.dynamic as { type: string }).type}`);
}

async function findFirstBilibiliVideoSelector(keyword: string): Promise<string> {
  const page = await getBrowserPage();
  for (let round = 0; round < 8; round += 1) {
    const candidate = await page.evaluate((target: string) => {
      const norm = (value: string | null | undefined) =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 20 && rect.height > 10 && style.display !== "none" && style.visibility !== "hidden";
      };
      const rows: Array<{ href: string; top: number; title: string }> = [];
      const nodes = Array.from(
        document.querySelectorAll("h3.bili-video-card__info--tit, .bili-video-card__info--tit, a[title], h3, a")
      );

      for (const el of nodes) {
        if (!visible(el)) continue;
        const text = norm(el.textContent);
        const title = norm(el.getAttribute("title"));
        const combined = `${title} ${text}`;
        const card = el.closest(".bili-video-card, .video-list-item, .video-item, [class*=video]") ?? el.parentElement;
        const link =
          el.closest("a") ??
          card?.querySelector?.('a[href*="/video/"], a[href*="BV"]');
        const href = (link as HTMLAnchorElement | null)?.href ?? "";
        if (combined.includes(target) && /video|BV/i.test(href)) {
          rows.push({ href, title: title || text, top: el.getBoundingClientRect().top + window.scrollY });
        }
      }

      rows.sort((a, b) => a.top - b.top);
      return rows[0] ?? null;
    }, keyword);

    if (candidate?.href) {
      const bv = candidate.href.match(/BV[a-zA-Z0-9]+/)?.[0];
      if (bv) return `a[href*="${bv}"]`;
      return `a[href="${candidate.href.replace(/"/g, '\\"')}"]`;
    }

    await page.mouse.wheel(0, 900).catch(() => undefined);
    await page.waitForTimeout(900).catch(() => undefined);
  }

  throw new Error(`No visible Bilibili video title contains "${keyword}".`);
}

function screenshotForWeb(shot: BrowserScreenshotResult | undefined): (BrowserScreenshotResult & { webUrl: string | null }) | null {
  if (!shot) return null;
  return { ...shot, webUrl: artifactUrlFromPath(shot.path) };
}

async function executeStep(
  step: BrowserPlanStep,
  index: number,
  total: number
): Promise<BrowserStepPayload> {
  const cursor = getBrowserCursor();
  const action = await resolveDynamicAction(step);
  const result = await cursor.run({
    id: `browser-exec-${Date.now()}-${index}`,
    action,
    wait: step.wait,
    expect: step.expect,
    createdAt: Date.now(),
  } satisfies BrowserRunRequest);
  const snapshot = await cursor.snapshot();
  return {
    index,
    total,
    goal: step.goal,
    action,
    result,
    snapshot,
    screenshot: screenshotForWeb(result.screenshot ?? snapshot.lastScreenshot ?? undefined),
  };
}

async function streamBrowserExecution(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (typeof body?.command !== "string") throw new Error("Missing command.");
  const plan = await judgeBrowserCommand(body.command);

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  const write = (payload: unknown) => {
    res.write(`${JSON.stringify(payload)}\n`);
  };

  write({ type: "plan", command: body.command, total: plan.length, plan });

  for (let i = 0; i < plan.length; i += 1) {
    const step = await executeStep(plan[i], i + 1, plan.length);
    write({ type: "step", step });
    if (!step.result.ok) {
      write({ type: "done", ok: false, summary: `Stopped after failed step ${i + 1}.` });
      res.end();
      return;
    }
  }

  write({ type: "done", ok: true, summary: `Executed ${plan.length} step(s).` });
  res.end();
}

getBrowserCursor();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(debugHtml);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      const relativePath = decodeURIComponent(url.pathname.slice("/artifacts/".length));
      const artifactsRoot = path.resolve(process.cwd(), "artifacts");
      const filePath = path.resolve(artifactsRoot, relativePath);
      const safeRelative = path.relative(artifactsRoot, filePath);
      if (safeRelative.startsWith("..") || path.isAbsolute(safeRelative)) {
        sendJson(res, 403, { ok: false, error: "Forbidden artifact path" });
        return;
      }
      const data = await readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", getStaticContentType(filePath));
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/browser/execute") {
      await streamBrowserExecution(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    res.write(`${JSON.stringify({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    res.end();
  }
}).listen(DEBUG_WEB_PORT, () => {
  console.log(`[BrowserExecutor] Ready at http://127.0.0.1:${DEBUG_WEB_PORT}`);
});
