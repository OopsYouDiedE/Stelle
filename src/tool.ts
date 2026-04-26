/**
 * 模块：统一工具层
 *
 * 运行逻辑：
 * 1. Cursor/Core/Debug 只能通过 ToolRegistry 调用外部能力。
 * 2. ToolRegistry 先检查 authority、allowedTools 和 inputSchema，再执行工具。
 * 3. 每次调用都会记录 audit，方便 debug console 查看副作用。
 * 4. 本文件集中定义全部工具命名空间：basic/fs/system/discord/search/memory/live/obs/tts。
 *
 * 主要方法：
 * - `ToolRegistry.execute()`：权限检查、输入校验、执行和审计。
 * - `createDefaultToolRegistry()`：装配默认工具集合。
 * - `create*Tools()`：按能力域注册具体工具。
 */
import { exec } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeErrorMessage } from "./utils/json.js";
import type { DiscordRuntime } from "./utils/discord.js";
import type { LiveRuntime, LiveMotionPriority } from "./utils/live.js";
import type { MemoryScope, MemoryStore } from "./utils/memory.js";
import { KokoroTtsProvider, type StreamingTtsProvider } from "./utils/tts.js";
import { sanitizeExternalText } from "./utils/text.js";

export type ToolAuthority = "readonly" | "safe_write" | "network_read" | "external_write" | "system";
export type ToolCaller = "cursor" | "runtime" | "debug" | "system" | "core";

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, { type?: string; items?: { type?: string }; description?: string }>;
  required?: string[];
}

export interface ToolSideEffectProfile {
  externalVisible: boolean;
  writesFileSystem: boolean;
  networkAccess: boolean;
  startsProcess: boolean;
  changesConfig: boolean;
  consumesBudget: boolean;
  affectsUserState: boolean;
}

export interface ToolContext {
  caller: ToolCaller;
  cursorId?: string;
  allowedAuthority: ToolAuthority[];
  allowedTools?: string[];
  cwd: string;
  signal?: AbortSignal;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolSideEffect {
  type: string;
  summary: string;
  visible: boolean;
  timestamp: number;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: ToolError;
  sideEffects?: ToolSideEffect[];
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  authority: ToolAuthority;
  inputSchema: ToolInputSchema;
  sideEffects: ToolSideEffectProfile;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> | ToolResult;
}

export interface ToolAuditRecord {
  id: string;
  toolName: string;
  caller: ToolCaller;
  cursorId?: string;
  authority: ToolAuthority;
  inputSummary: string;
  resultSummary: string;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  sideEffects: ToolSideEffect[];
}

const SAFE_EXPR = /^[0-9+\-*/().,%\s]+$/;

// 模块：通用 ToolResult / sideEffects 构造器。
export function ok(summary: string, data?: Record<string, unknown>): ToolResult {
  return { ok: true, summary, data };
}

export function fail(code: string, message: string, retryable = false): ToolResult {
  return { ok: false, summary: message, error: { code, message, retryable } };
}

export function sideEffects(overrides: Partial<ToolSideEffectProfile> = {}): ToolSideEffectProfile {
  return {
    externalVisible: false,
    writesFileSystem: false,
    networkAccess: false,
    startsProcess: false,
    changesConfig: false,
    consumesBudget: false,
    affectsUserState: false,
    ...overrides,
  };
}

// 模块：Registry 核心执行器，负责权限、schema、执行和审计。
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  readonly audit: ToolAuditRecord[] = [];

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return fail("tool_not_found", `Tool is not registered: ${name}.`);

    const startedAt = Date.now();
    let result: ToolResult;
    try {
      result =
        this.checkAuthority(tool, context) ??
        this.checkToolWhitelist(tool, context) ??
        this.checkSchema(tool, input) ??
        (await tool.execute(input, context));
    } catch (error) {
      result = fail("tool_execution_failed", safeErrorMessage(error));
    }
    const finishedAt = Date.now();

    this.audit.push({
      id: `audit-${startedAt}-${Math.random().toString(36).slice(2)}`,
      toolName: name,
      caller: context.caller,
      cursorId: context.cursorId,
      authority: tool.authority,
      inputSummary: Object.keys(input).join(", ") || "empty",
      resultSummary: result.summary,
      ok: result.ok,
      startedAt,
      finishedAt,
      sideEffects: result.sideEffects ?? [],
    });

    return result;
  }

  private checkAuthority(tool: ToolDefinition, context: ToolContext): ToolResult | undefined {
    if (context.allowedAuthority.includes(tool.authority)) return undefined;
    return fail("authority_denied", `Caller ${context.caller} cannot use ${tool.authority} tool ${tool.name}.`);
  }

  private checkToolWhitelist(tool: ToolDefinition, context: ToolContext): ToolResult | undefined {
    if (!context.allowedTools || context.allowedTools.length === 0) {
      return context.caller === "cursor" || context.caller === "core"
        ? fail("tool_not_whitelisted", `Caller ${context.caller} must provide a tool whitelist for ${tool.name}.`)
        : undefined;
    }
    return context.allowedTools.includes(tool.name)
      ? undefined
      : fail("tool_not_whitelisted", `Tool ${tool.name} is not whitelisted for caller ${context.caller}.`);
  }

  private checkSchema(tool: ToolDefinition, input: Record<string, unknown>): ToolResult | undefined {
    for (const key of tool.inputSchema.required ?? []) {
      if (!(key in input)) return fail("invalid_input", `Missing required field: ${key}.`);
    }
    for (const [key, schema] of Object.entries(tool.inputSchema.properties)) {
      if (!(key in input) || input[key] === undefined) continue;
      const issue = validateValue(key, input[key], schema);
      if (issue) return fail("invalid_input", issue);
    }
    return undefined;
  }
}

export interface ToolRegistryDeps {
  cwd?: string;
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  memory?: MemoryStore;
  tts?: StreamingTtsProvider;
}

// 模块：默认工具装配入口。
export function createDefaultToolRegistry(deps: ToolRegistryDeps = {}): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of [
    ...createCoreTools(),
    ...createDiscordTools(deps),
    ...createSearchTools(),
    ...createMemoryTools(deps),
    ...createLiveTools(deps),
    ...createTtsTools(deps.tts ?? new KokoroTtsProvider()),
  ]) {
    registry.register(tool);
  }
  return registry;
}

// 模块：基础工具 basic.* / fs.* / system.*。
function createCoreTools(): ToolDefinition[] {
  return [
    {
      name: "basic.datetime",
      title: "Current Date/Time",
      description: "Read the current local date and time.",
      authority: "readonly",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects(),
      execute() {
        const now = new Date();
        return ok("Current datetime read.", { iso: now.toISOString(), local: now.toString(), timestamp: now.getTime() });
      },
    },
    {
      name: "basic.calculate",
      title: "Basic Calculator",
      description: "Evaluate a basic arithmetic expression.",
      authority: "readonly",
      inputSchema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
      sideEffects: sideEffects(),
      execute(input) {
        const expression = String(input.expression ?? "");
        if (!SAFE_EXPR.test(expression)) return fail("unsupported_expression", "Only basic arithmetic is allowed.");
        try {
          const value = Function(`"use strict"; return (${expression});`)() as number;
          return Number.isFinite(value) ? ok(String(value), { value }) : fail("non_finite", "Expression did not produce a finite number.");
        } catch (error) {
          return fail("calculation_failed", safeErrorMessage(error));
        }
      },
    },
    {
      name: "fs.list_directory",
      title: "List Directory",
      description: "List entries in a workspace directory.",
      authority: "readonly",
      inputSchema: { type: "object", properties: { directory_path: { type: "string" } } },
      sideEffects: sideEffects(),
      async execute(input, context) {
        const cwd = path.resolve(context.cwd);
        const target = workspacePath(context, typeof input.directory_path === "string" ? input.directory_path : ".");
        const entries = await readdir(target, { withFileTypes: true });
        const items = await Promise.all(
          entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
            const fullPath = path.join(target, entry.name);
            const info = await stat(fullPath);
            return { kind: entry.isDirectory() ? "dir" : "file", size: info.size, path: path.relative(cwd, fullPath) || entry.name };
          })
        );
        return ok(`Listed ${items.length} entries.`, { items });
      },
    },
    {
      name: "fs.read_file",
      title: "Read File",
      description: "Read a UTF-8 workspace file.",
      authority: "readonly",
      inputSchema: {
        type: "object",
        properties: { file_path: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" } },
        required: ["file_path"],
      },
      sideEffects: sideEffects(),
      async execute(input, context) {
        const target = workspacePath(context, String(input.file_path));
        const content = await readFile(target, "utf8");
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, Number(input.start_line ?? 1));
        const end = Math.min(lines.length, Number(input.end_line ?? lines.length));
        return ok(`Read ${end - start + 1} lines.`, {
          filePath: path.relative(context.cwd, target),
          startLine: start,
          endLine: end,
          totalLines: lines.length,
          content: lines.slice(start - 1, end).join("\n"),
        });
      },
    },
    {
      name: "fs.write_file",
      title: "Write File",
      description: "Write a UTF-8 workspace file.",
      authority: "safe_write",
      inputSchema: {
        type: "object",
        properties: { file_path: { type: "string" }, content: { type: "string" } },
        required: ["file_path", "content"],
      },
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input, context) {
        const target = workspacePath(context, String(input.file_path));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, String(input.content ?? ""), "utf8");
        return {
          ...ok(`Wrote ${path.relative(context.cwd, target)}.`, { chars: String(input.content ?? "").length }),
          sideEffects: [{ type: "file_write", summary: "Wrote workspace file.", visible: false, timestamp: Date.now() }],
        };
      },
    },
    {
      name: "system.run_command",
      title: "Run Command",
      description: "Run a workspace shell command.",
      authority: "system",
      inputSchema: { type: "object", properties: { command: { type: "string" }, timeout_ms: { type: "integer" } }, required: ["command"] },
      sideEffects: sideEffects({ startsProcess: true }),
      execute(input, context) {
        return new Promise<ToolResult>((resolve) => {
          exec(
            String(input.command),
            {
              cwd: context.cwd,
              timeout: Number(input.timeout_ms ?? 20000),
              windowsHide: true,
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
            },
            (error, stdout, stderr) => {
              resolve({
                ok: !error,
                summary: error ? `Command failed with exit code ${error.code ?? "unknown"}.` : "Command completed.",
                data: { stdout, stderr, exitCode: error?.code ?? 0 },
                error: error ? { code: "command_failed", message: error.message, retryable: false } : undefined,
                sideEffects: [{ type: "process", summary: "Ran shell command.", visible: false, timestamp: Date.now() }],
              });
            }
          );
        });
      },
    },
  ];
}

// 模块：Discord 工具 discord.*。
function createDiscordTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const discordRequired = (): DiscordRuntime => {
    if (!deps.discord) throw new Error("Discord runtime is not configured.");
    return deps.discord;
  };

  return [
    {
      name: "discord.status",
      title: "Discord Status",
      description: "Read Discord runtime connection status.",
      authority: "readonly",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects({ networkAccess: true }),
      async execute() {
        return ok("Discord status read.", { status: await discordRequired().getStatus() });
      },
    },
    {
      name: "discord.get_message",
      title: "Get Discord Message",
      description: "Read a Discord message by channel and message ID.",
      authority: "readonly",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" }, message_id: { type: "string" } },
        required: ["channel_id", "message_id"],
      },
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const message = await discordRequired().getMessage(String(input.channel_id), String(input.message_id));
        return ok(`Read Discord message ${message.id}.`, { message });
      },
    },
    {
      name: "discord.get_channel_history",
      title: "Get Discord Channel History",
      description: "Read recent Discord channel history.",
      authority: "readonly",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" }, limit: { type: "integer" } },
        required: ["channel_id"],
      },
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const messages = await discordRequired().getChannelHistory({
          channelId: String(input.channel_id),
          limit: Number(input.limit ?? 20),
        });
        return ok(`Read ${messages.length} Discord messages.`, { messages });
      },
    },
    {
      name: "discord.reply_message",
      title: "Reply Discord Message",
      description: "Reply to a specific Discord message.",
      authority: "external_write",
      inputSchema: {
        type: "object",
        properties: { channel_id: { type: "string" }, message_id: { type: "string" }, content: { type: "string" } },
        required: ["channel_id", "message_id", "content"],
      },
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({
          channelId: String(input.channel_id),
          replyToMessageId: String(input.message_id),
          content: sanitizeExternalText(input.content),
        });
        return {
          ...ok(`Replied with Discord message ${message.id}.`, { message }),
          sideEffects: [{ type: "discord_reply_sent", summary: `Sent reply ${message.id}.`, visible: true, timestamp: Date.now() }],
        };
      },
    },
    {
      name: "discord.send_message",
      title: "Send Discord Message",
      description: "Send a Discord message to a channel.",
      authority: "external_write",
      inputSchema: {
        type: "object",
        properties: {
          channel_id: { type: "string" },
          content: { type: "string" },
          mention_user_ids: { type: "array", items: { type: "string" } },
          reply_to_message_id: { type: "string" },
        },
        required: ["channel_id", "content"],
      },
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({
          channelId: String(input.channel_id),
          content: sanitizeExternalText(input.content),
          mentionUserIds: Array.isArray(input.mention_user_ids) ? input.mention_user_ids.map(String) : undefined,
          replyToMessageId: typeof input.reply_to_message_id === "string" ? input.reply_to_message_id : undefined,
        });
        return {
          ...ok(`Sent Discord message ${message.id}.`, { message }),
          sideEffects: [{ type: "discord_message_sent", summary: `Sent message ${message.id}.`, visible: true, timestamp: Date.now() }],
        };
      },
    },
  ];
}

// 模块：外部检索工具 search.*。
function createSearchTools(): ToolDefinition[] {
  return [
    {
      name: "search.web_search",
      title: "Web Search",
      description: "Search public web pages using a lightweight DuckDuckGo HTML fallback.",
      authority: "network_read",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, count: { type: "integer" } },
        required: ["query"],
      },
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const query = String(input.query ?? "").trim();
        if (!query) return fail("invalid_query", "Search query must not be empty.");
        const count = Math.max(1, Math.min(10, Number(input.count ?? 5)));
        const results = await duckDuckGoHtmlSearch(query, count);
        return ok(`Found ${results.length} web result(s).`, { query, results });
      },
    },
    {
      name: "search.web_read",
      title: "Web Read",
      description: "Fetch a public HTTP(S) page and return compact readable text.",
      authority: "network_read",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" }, max_chars: { type: "integer" } },
        required: ["url"],
      },
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const url = new URL(String(input.url));
        if (!["http:", "https:"].includes(url.protocol)) return fail("unsupported_protocol", "Only HTTP(S) URLs are allowed.");
        const response = await fetch(url, { headers: { "user-agent": browserUserAgent(), accept: "text/html,text/plain;q=0.9,*/*;q=0.8" } });
        if (!response.ok) throw new Error(`web_read failed: ${response.status} ${response.statusText}`);
        const raw = await response.text();
        const text = htmlToText(raw);
        const maxChars = Math.max(1000, Math.min(30000, Number(input.max_chars ?? 8000)));
        return ok(`Read ${Math.min(maxChars, text.length)} chars from ${response.url}.`, {
          url: response.url,
          text: text.slice(0, maxChars),
          length: text.length,
          truncated: text.length > maxChars,
        });
      },
    },
  ];
}

// 模块：记忆工具 memory.*。
function createMemoryTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const memoryRequired = (): MemoryStore => {
    if (!deps.memory) throw new Error("Memory store is not configured.");
    return deps.memory;
  };

  return [
    {
      name: "memory.write_recent",
      title: "Write Recent Memory",
      description: "Append a recent memory entry to a scoped memory buffer.",
      authority: "safe_write",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "object" },
          id: { type: "string" },
          source: { type: "string" },
          type: { type: "string" },
          text: { type: "string" },
          metadata: { type: "object" },
        },
        required: ["scope", "source", "type", "text"],
      },
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const scope = parseMemoryScope(input.scope);
        const id = typeof input.id === "string" ? input.id : `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await memoryRequired().writeRecent(scope, {
          id,
          timestamp: Date.now(),
          source: parseMemorySource(input.source),
          type: String(input.type),
          text: sanitizeExternalText(input.text),
          metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? (input.metadata as Record<string, unknown>) : undefined,
        });
        return ok(`Wrote recent memory ${id}.`, { id });
      },
    },
    {
      name: "memory.read_recent",
      title: "Read Recent Memory",
      description: "Read recent entries from a memory scope.",
      authority: "readonly",
      inputSchema: { type: "object", properties: { scope: { type: "object" }, limit: { type: "integer" } }, required: ["scope"] },
      sideEffects: sideEffects(),
      async execute(input) {
        const entries = await memoryRequired().readRecent(parseMemoryScope(input.scope), Number(input.limit ?? 20));
        return ok(`Read ${entries.length} recent memory entries.`, { entries });
      },
    },
    {
      name: "memory.search",
      title: "Search Memory",
      description: "Search scoped historical memory summaries.",
      authority: "readonly",
      inputSchema: {
        type: "object",
        properties: { scope: { type: "object" }, text: { type: "string" }, keywords: { type: "array", items: { type: "string" } }, limit: { type: "integer" } },
        required: ["scope"],
      },
      sideEffects: sideEffects(),
      async execute(input) {
        const results = await memoryRequired().searchHistory(parseMemoryScope(input.scope), {
          text: typeof input.text === "string" ? input.text : undefined,
          keywords: Array.isArray(input.keywords) ? input.keywords.map(String) : undefined,
          limit: Number(input.limit ?? 3),
        });
        return ok(`Found ${results.length} memory result(s).`, { results });
      },
    },
    {
      name: "memory.read_long_term",
      title: "Read Long-Term Memory",
      description: "Read a long-term memory value by key.",
      authority: "readonly",
      inputSchema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
      sideEffects: sideEffects(),
      async execute(input) {
        const value = await memoryRequired().readLongTerm(String(input.key));
        return ok(value ? `Read long-term memory ${input.key}.` : `Long-term memory ${input.key} is empty.`, { value });
      },
    },
    {
      name: "memory.write_long_term",
      title: "Write Long-Term Memory",
      description: "Write a long-term memory value by key.",
      authority: "safe_write",
      inputSchema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        await memoryRequired().writeLongTerm(String(input.key), String(input.value));
        return ok(`Wrote long-term memory ${input.key}.`);
      },
    },
    {
      name: "memory.append_research_log",
      title: "Append Research Log",
      description: "Append a StelleCore research log.",
      authority: "safe_write",
      inputSchema: {
        type: "object",
        properties: { focus: { type: "string" }, process: { type: "array", items: { type: "string" } }, conclusion: { type: "string" } },
        required: ["focus", "conclusion"],
      },
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const id = await memoryRequired().appendResearchLog({
          focus: String(input.focus),
          process: Array.isArray(input.process) ? input.process.map(String) : [],
          conclusion: String(input.conclusion),
        });
        return ok(`Appended research log ${id}.`, { id });
      },
    },
  ];
}

// 模块：直播舞台工具 live.* / obs.*。
function createLiveTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const liveRequired = (): LiveRuntime => {
    if (!deps.live) throw new Error("Live runtime is not configured.");
    return deps.live;
  };

  return [
    {
      name: "live.status",
      title: "Live Status",
      description: "Read live runtime status.",
      authority: "readonly",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects(),
      async execute() {
        return ok("Live status read.", { status: await liveRequired().getStatus() });
      },
    },
    {
      name: "live.get_stage",
      title: "Get Live Stage",
      description: "Read current Live stage state.",
      authority: "readonly",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects(),
      async execute() {
        const status = await liveRequired().getStatus();
        return ok("Live stage read.", { stage: status.stage });
      },
    },
    liveActionTool("live.set_caption", "Set Live Caption", { text: { type: "string" } }, ["text"], async (live, input) => live.setCaption(String(input.text))),
    liveActionTool(
      "live.stream_caption",
      "Stream Live Caption",
      { text: { type: "string" }, speaker: { type: "string" }, rate_ms: { type: "integer" } },
      ["text"],
      async (live, input) => live.streamCaption(String(input.text), typeof input.speaker === "string" ? input.speaker : undefined, Number(input.rate_ms ?? 34))
    ),
    liveActionTool(
      "live.show_route_decision",
      "Show Live Route Decision",
      {
        event_id: { type: "string" },
        action: { type: "string" },
        reason: { type: "string" },
        text: { type: "string" },
        user_name: { type: "string" },
      },
      ["event_id", "action", "reason"],
      async (live, input) =>
        live.showRouteDecision({
          eventId: String(input.event_id),
          action: String(input.action),
          reason: String(input.reason),
          text: typeof input.text === "string" ? input.text : undefined,
          userName: typeof input.user_name === "string" ? input.user_name : undefined,
        })
    ),
    liveActionTool(
      "live.push_event",
      "Push Live Panel Event",
      {
        event_id: { type: "string" },
        lane: { type: "string" },
        text: { type: "string" },
        user_name: { type: "string" },
        priority: { type: "string" },
        note: { type: "string" },
      },
      ["lane", "text"],
      async (live, input) =>
        live.pushEvent({
          eventId: typeof input.event_id === "string" ? input.event_id : undefined,
          lane: String(input.lane) as "incoming" | "response" | "topic" | "system",
          text: String(input.text),
          userName: typeof input.user_name === "string" ? input.user_name : undefined,
          priority: typeof input.priority === "string" ? (input.priority as "low" | "medium" | "high") : undefined,
          note: typeof input.note === "string" ? input.note : undefined,
        })
    ),
    liveActionTool("live.clear_caption", "Clear Live Caption", {}, [], async (live) => live.clearCaption()),
    liveActionTool(
      "live.trigger_motion",
      "Trigger Live Motion",
      { group: { type: "string" }, priority: { type: "string" } },
      ["group"],
      async (live, input) => live.triggerMotion(String(input.group), (typeof input.priority === "string" ? input.priority : "normal") as LiveMotionPriority)
    ),
    liveActionTool("live.set_expression", "Set Live Expression", { expression: { type: "string" } }, ["expression"], async (live, input) => live.setExpression(String(input.expression))),
    liveActionTool("live.set_background", "Set Live Background", { source: { type: "string" } }, ["source"], async (live, input) => live.setBackground(String(input.source))),
    {
      name: "live.stream_tts_caption",
      title: "Stream Live TTS Caption",
      description: "Set live caption and queue a Kokoro browser stream.",
      authority: "external_write",
      inputSchema: { type: "object", properties: { text: { type: "string" }, voice_name: { type: "string" } }, required: ["text"] },
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, consumesBudget: true, affectsUserState: true }),
      async execute(input) {
        const live = liveRequired();
        const text = sanitizeExternalText(input.text);
        await live.setCaption(text);
        const result = await live.playTtsStream(text, {
          model: process.env.KOKORO_TTS_MODEL ?? "kokoro",
          input: text,
          voice: typeof input.voice_name === "string" ? input.voice_name : process.env.KOKORO_TTS_VOICE ?? "zf_xiaobei",
          response_format: process.env.KOKORO_TTS_STREAM_RESPONSE_FORMAT ?? process.env.KOKORO_TTS_RESPONSE_FORMAT ?? "wav",
          stream: true,
        });
        return { ...ok(result.summary, { result }), sideEffects: [{ type: "live_tts_caption", summary: result.summary, visible: true, timestamp: Date.now() }] };
      },
    },
    {
      name: "obs.status",
      title: "OBS Status",
      description: "Read OBS status through Live runtime.",
      authority: "readonly",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects({ networkAccess: true }),
      async execute() {
        return ok("OBS status read.", { status: (await liveRequired().getStatus()).obs });
      },
    },
    liveObsTool("obs.start_stream", "Start OBS Stream", async (live) => live.obs.startStream()),
    liveObsTool("obs.stop_stream", "Stop OBS Stream", async (live) => live.obs.stopStream()),
  ];

  function liveActionTool(
    name: string,
    title: string,
    properties: ToolInputSchema["properties"],
    required: string[],
    action: (live: LiveRuntime, input: Record<string, unknown>) => Promise<{ ok: boolean; summary: string }>
  ): ToolDefinition {
    return {
      name,
      title,
      description: title,
      authority: "external_write",
      inputSchema: { type: "object", properties, required },
      sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }),
      async execute(input) {
        const result = await action(liveRequired(), input);
        return {
          ok: result.ok,
          summary: result.summary,
          data: { result },
          sideEffects: [{ type: name, summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      },
    };
  }

  function liveObsTool(
    name: string,
    title: string,
    action: (live: LiveRuntime) => Promise<{ ok: boolean; summary: string }>
  ): ToolDefinition {
    return {
      name,
      title,
      description: title,
      authority: "external_write",
      inputSchema: { type: "object", properties: {} },
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute() {
        const result = await action(liveRequired());
        return { ok: result.ok, summary: result.summary, data: { result }, sideEffects: [{ type: name, summary: result.summary, visible: true, timestamp: Date.now() }] };
      },
    };
  }
}

// 模块：语音合成工具 tts.*。
function createTtsTools(provider: StreamingTtsProvider): ToolDefinition[] {
  return [
    {
      name: "tts.kokoro_speech",
      title: "Kokoro Speech",
      description: "Synthesize text to local Kokoro audio artifacts.",
      authority: "safe_write",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, output_dir: { type: "string" }, file_prefix: { type: "string" }, voice_name: { type: "string" } },
        required: ["text"],
      },
      sideEffects: sideEffects({ writesFileSystem: true, networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const artifacts = await provider.synthesizeToFiles(String(input.text), {
          outputDir: typeof input.output_dir === "string" ? input.output_dir : undefined,
          filePrefix: typeof input.file_prefix === "string" ? input.file_prefix : undefined,
          voiceName: typeof input.voice_name === "string" ? input.voice_name : undefined,
        });
        return {
          ...ok(`Kokoro wrote ${artifacts.length} audio artifact(s).`, { artifacts }),
          sideEffects: artifacts.map((artifact) => ({ type: "tts_audio_artifact", summary: `Wrote ${artifact.path}.`, visible: false, timestamp: Date.now() })),
        };
      },
    },
  ];
}

// 模块：工具层内部 helper，包括 workspace 边界、schema 检查、HTML 搜索解析和 memory scope 解析。
function workspacePath(context: ToolContext, filePath?: string): string {
  const cwd = path.resolve(context.cwd);
  const target = path.resolve(cwd, filePath ?? ".");
  if (target !== cwd && !target.startsWith(cwd + path.sep)) {
    throw new Error(`Path is outside workspace: ${target}`);
  }
  return target;
}

function validateValue(
  key: string,
  value: unknown,
  schema: { type?: string; items?: { type?: string } }
): string | undefined {
  if (!schema.type) return undefined;
  if (schema.type === "string") return typeof value === "string" ? undefined : `Field ${key} must be a string.`;
  if (schema.type === "boolean") return typeof value === "boolean" ? undefined : `Field ${key} must be a boolean.`;
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value) ? undefined : `Field ${key} must be a finite number.`;
  if (schema.type === "integer") return typeof value === "number" && Number.isInteger(value) ? undefined : `Field ${key} must be an integer.`;
  if (schema.type === "object") return value && typeof value === "object" && !Array.isArray(value) ? undefined : `Field ${key} must be an object.`;
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `Field ${key} must be an array.`;
    if (!schema.items?.type) return undefined;
    for (const item of value) {
      if (schema.items.type === "string" && typeof item !== "string") return `Field ${key} must be an array of strings.`;
    }
  }
  return undefined;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

async function duckDuckGoHtmlSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, { headers: { "user-agent": browserUserAgent() } });
  if (!response.ok) throw new Error(`DuckDuckGo search failed: ${response.status} ${response.statusText}`);
  const html = await response.text();
  const blocks = html.split(/<div class="result[\s"]/i).slice(1);
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const normalizedUrl = normalizeDuckDuckGoUrl(linkMatch[1]!);
    if (!normalizedUrl) continue;
    results.push({
      title: stripTags(linkMatch[2]!),
      url: normalizedUrl,
      snippet: snippetMatch ? stripTags(snippetMatch[1]!) : "",
      source: "duckduckgo_html",
    });
    if (results.length >= count) break;
  }
  return results;
}

function browserUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeDuckDuckGoUrl(rawUrl: string): string | null {
  let url = decodeHtmlEntities(rawUrl);
  const redirect = url.match(/[?&]uddg=([^&]+)/);
  if (redirect) url = decodeURIComponent(redirect[1]!);
  if (url.includes("duckduckgo.com/y.js") || url.includes("bing.com/aclick") || url.includes("/aclick?")) return null;
  return url;
}

function parseMemoryScope(value: unknown): MemoryScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "long_term" };
  const record = value as Record<string, unknown>;
  if (record.kind === "discord_channel") return { kind: "discord_channel", channelId: String(record.channelId ?? record.channel_id ?? "unknown"), guildId: record.guildId ? String(record.guildId) : null };
  if (record.kind === "live") return { kind: "live" };
  return { kind: "long_term" };
}

function parseMemorySource(value: unknown): "discord" | "live" | "core" | "debug" {
  return value === "discord" || value === "live" || value === "core" || value === "debug" ? value : "debug";
}
