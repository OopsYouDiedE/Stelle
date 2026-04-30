import { z } from "zod";
import { exec } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeErrorMessage } from "../../utils/json.js";
import type { DiscordRuntime } from "../../utils/discord.js";
import type { LiveRuntime } from "../../utils/live.js";
import type { MemoryStore } from "../../utils/memory.js";
import { getConfiguredTtsProviderName, type StreamingTtsProvider } from "../../utils/tts.js";
import { sanitizeExternalText } from "../../utils/text.js";
import type { SceneObserver } from "../../scene/observer.js";
import type { StelleEventBus } from "../../utils/event_bus.js";
import { ok, fail, sideEffects } from "../types.js";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";
import { validatePublicHttpUrl } from "../security.js";

export interface ToolRegistryDeps {
  cwd?: string;
  discord?: DiscordRuntime;
  live?: LiveRuntime;
  memory?: MemoryStore;
  tts?: StreamingTtsProvider;
  sceneObserver?: SceneObserver;
  eventBus?: StelleEventBus;
}

const SAFE_EXPR = /^[0-9+\-*/().,%\s]+$/;
export function createSceneTools(deps: ToolRegistryDeps): ToolDefinition[] {
  return [
    {
      name: "scene.observe",
      title: "Observe Scene",
      description: "Read a structured, read-only observation of the current live scene.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      async execute() {
        if (!deps.sceneObserver) return fail("scene_unavailable", "Scene observer is not configured.");
        const observation = await deps.sceneObserver.observe();
        deps.eventBus?.publish({
          type: "scene.observation.received",
          source: "scene",
          id: `scene-observation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: observation.timestamp,
          payload: observation as any,
        } as any);
        return ok("Scene observed.", { observation });
      },
    },
  ];
}

export function createCoreTools(): ToolDefinition[] {
  return [
    {
      name: "basic.datetime",
      title: "Current Date/Time",
      description: "Read the current local date and time.",
      authority: "readonly",
      inputSchema: z.object({}),
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
      inputSchema: z.object({ expression: z.string() }),
      sideEffects: sideEffects(),
      execute(input) {
        if (!SAFE_EXPR.test(input.expression)) return fail("unsupported_expression", "Only basic arithmetic is allowed.");
        try {
          const value = Function(`"use strict"; return (${input.expression});`)() as number;
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
      inputSchema: z.object({ directory_path: z.string().optional().default(".") }),
      sideEffects: sideEffects(),
      async execute(input, context) {
        const cwd = path.resolve(context.cwd);
        const target = workspacePath(context, input.directory_path);
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
      inputSchema: z.object({ file_path: z.string(), start_line: z.number().int().optional(), end_line: z.number().int().optional() }),
      sideEffects: sideEffects(),
      async execute(input, context) {
        const target = workspacePath(context, input.file_path);
        const content = await readFile(target, "utf8");
        const lines = content.split(/\r?\n/);
        const start = Math.max(1, input.start_line ?? 1);
        const end = Math.min(lines.length, input.end_line ?? lines.length);
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
      description: "Write a UTF-8 workspace file atomically.",
      authority: "safe_write",
      inputSchema: z.object({ file_path: z.string(), content: z.string() }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input, context) {
        const target = workspacePath(context, input.file_path);
        await mkdir(path.dirname(target), { recursive: true });
        await atomicWrite(target, input.content);
        return {
          ...ok(`Wrote ${path.relative(context.cwd, target)}.`, { chars: input.content.length }),
          sideEffects: [{ type: "file_write", summary: "Wrote workspace file.", visible: false, timestamp: Date.now() }],
        };
      },
    },
    {
      name: "system.run_command",
      title: "Run Command",
      description: "Run a workspace shell command.",
      authority: "system",
      inputSchema: z.object({ command: z.string(), timeout_ms: z.number().int().optional().default(20000) }),
      sideEffects: sideEffects({ startsProcess: true }),
      execute(input, context) {
        return new Promise<ToolResult>((resolve) => {
          exec(
            input.command,
            { cwd: context.cwd, timeout: input.timeout_ms, windowsHide: true, encoding: "utf8", maxBuffer: 1024 * 1024 },
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

export function createDiscordTools(deps: ToolRegistryDeps): ToolDefinition[] {
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
      inputSchema: z.object({}),
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
      inputSchema: z.object({ channel_id: z.string(), message_id: z.string() }),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const message = await discordRequired().getMessage(input.channel_id, input.message_id);
        return ok(`Read Discord message ${message.id}.`, { message });
      },
    },
    {
      name: "discord.get_channel_history",
      title: "Get Discord Channel History",
      description: "Read recent Discord channel history.",
      authority: "readonly",
      inputSchema: z.object({ channel_id: z.string(), limit: z.number().int().min(1).max(100).optional().default(20) }),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute(input) {
        const messages = await discordRequired().getChannelHistory({ channelId: input.channel_id, limit: input.limit });
        return ok(`Read ${messages.length} Discord messages.`, { messages });
      },
    },
    {
      name: "discord.reply_message",
      title: "Reply Discord Message",
      description: "Reply to a specific Discord message.",
      authority: "external_write",
      inputSchema: z.object({ channel_id: z.string(), message_id: z.string(), content: z.string().min(1) }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({ channelId: input.channel_id, replyToMessageId: input.message_id, content: sanitizeExternalText(input.content) });
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
      inputSchema: z.object({ channel_id: z.string(), content: z.string().min(1), mention_user_ids: z.array(z.string()).optional(), reply_to_message_id: z.string().optional() }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const message = await discordRequired().sendMessage({ channelId: input.channel_id, content: sanitizeExternalText(input.content), mentionUserIds: input.mention_user_ids, replyToMessageId: input.reply_to_message_id });
        return {
          ...ok(`Sent Discord message ${message.id}.`, { message }),
          sideEffects: [{ type: "discord_message_sent", summary: `Sent message ${message.id}.`, visible: true, timestamp: Date.now() }],
        };
      },
    },
  ];
}

export function createSearchTools(): ToolDefinition[] {
  return [
    {
      name: "search.web_search",
      title: "Web Search",
      description: "Search public web pages.",
      authority: "network_read",
      inputSchema: z.object({ query: z.string().min(1), count: z.number().int().min(1).max(10).optional().default(5) }),
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const results = await duckDuckGoHtmlSearch(input.query, input.count);
        return ok(`Found ${results.length} web result(s).`, { query: input.query, results });
      },
    },
    {
      name: "search.web_read",
      title: "Web Read",
      description: "Fetch a public HTTP(S) page.",
      authority: "network_read",
      inputSchema: z.object({ url: z.string().url(), max_chars: z.number().int().min(500).max(50000).optional().default(8000) }),
      sideEffects: sideEffects({ networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const url = new URL(input.url);
        const blocked = await validatePublicHttpUrl(url);
        if (blocked) return blocked;
        const response = await fetchPublicUrl(url);
        if (!response.ok) throw new Error(`web_read failed: ${response.status}`);
        const raw = await response.text();
        const text = htmlToText(raw);
        return ok(`Read ${Math.min(input.max_chars, text.length)} chars from ${response.url}.`, { url: response.url, text: text.slice(0, input.max_chars), length: text.length });
      },
    },
  ];
}

export function createMemoryTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const memoryRequired = (): MemoryStore => {
    if (!deps.memory) throw new Error("Memory store is not configured.");
    return deps.memory;
  };
  const MemoryScopeSchema = z.object({ kind: z.enum(["discord_channel", "discord_global", "live", "long_term"]), channelId: z.string().optional(), guildId: z.string().nullable().optional() });

  return [
    {
      name: "memory.write_recent",
      title: "Write Recent Memory",
      description: "Append a recent memory entry.",
      authority: "safe_write",
      inputSchema: z.object({ scope: MemoryScopeSchema, id: z.string().optional(), source: z.enum(["discord", "live", "core", "debug"]), type: z.string(), text: z.string().min(1), metadata: z.record(z.any()).optional() }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const id = input.id || `mem-${Date.now()}`;
        await memoryRequired().writeRecent(input.scope as any, { id, timestamp: Date.now(), source: input.source, type: input.type, text: sanitizeExternalText(input.text), metadata: input.metadata });
        return ok(`Wrote recent memory ${id}.`, { id });
      },
    },
    {
      name: "memory.propose_write",
      title: "Propose Memory Write",
      description: "Suggest a fact to be remembered long-term.",
      authority: "readonly",
      inputSchema: z.object({ content: z.string().min(1), reason: z.string(), layer: z.enum(["user_facts", "observations"]).optional().default("user_facts") }),
      sideEffects: sideEffects({ affectsUserState: true }),
      async execute(input, context) {
        const id = await memoryRequired().proposeMemory({ authorId: context.cursorId || "unknown", source: context.caller, content: input.content, reason: input.reason, layer: input.layer as any });
        return ok(`Memory proposal submitted: ${id}.`, { proposal_id: id });
      },
    },
    {
      name: "memory.read_recent",
      title: "Read Recent Memory",
      description: "Read recent entries.",
      authority: "readonly",
      inputSchema: z.object({ scope: MemoryScopeSchema, limit: z.number().int().min(1).max(100).optional().default(20) }),
      sideEffects: sideEffects(),
      async execute(input) {
        const entries = await memoryRequired().readRecent(input.scope as any, input.limit);
        return ok(`Read ${entries.length} entries.`, { entries });
      },
    },
    {
      name: "memory.search",
      title: "Search Memory",
      description: "Search scoped memory.",
      authority: "readonly",
      inputSchema: z.object({ scope: MemoryScopeSchema, text: z.string().optional(), keywords: z.array(z.string()).optional(), limit: z.number().int().optional().default(3) }),
      sideEffects: sideEffects(),
      async execute(input) {
        const results = await memoryRequired().searchHistory(input.scope as any, { text: input.text, keywords: input.keywords, limit: input.limit });
        return ok(`Found ${results.length} result(s).`, { results });
      },
    },
    {
      name: "memory.read_long_term",
      title: "Read Long-Term Memory",
      description: "Read a long-term memory key.",
      authority: "readonly",
      inputSchema: z.object({ key: z.string().min(1), layer: z.enum(["user_facts", "self_state", "core_identity"]).optional().default("self_state") }),
      sideEffects: sideEffects(),
      async execute(input) {
        const value = await memoryRequired().readLongTerm(input.key, input.layer as any);
        return ok(value ? `Read ${input.key}.` : `Key ${input.key} empty.`, { value });
      },
    },
    {
      name: "memory.write_long_term",
      title: "Write Long-Term Memory",
      description: "Write a long-term memory key. System only.",
      authority: "safe_write",
      inputSchema: z.object({ key: z.string().min(1), value: z.string().min(1), layer: z.enum(["user_facts", "self_state", "core_identity", "research_logs"]).optional().default("self_state") }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        await memoryRequired().writeLongTerm(input.key, input.value, input.layer as any);
        return ok(`Wrote ${input.key} to ${input.layer}.`);
      },
    },
    {
      name: "memory.append_long_term",
      title: "Append Long-Term Memory",
      description: "Append to a long-term memory key without replacing existing content.",
      authority: "safe_write",
      inputSchema: z.object({ key: z.string().min(1), value: z.string().min(1), layer: z.enum(["user_facts", "self_state", "core_identity", "research_logs", "observations"]).optional().default("observations") }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        await memoryRequired().appendLongTerm(input.key, input.value, input.layer as any);
        return ok(`Appended ${input.key} to ${input.layer}.`);
      },
    },
    {
      name: "memory.append_research_log",
      title: "Append Research Log",
      description: "Append a reflection log.",
      authority: "safe_write",
      inputSchema: z.object({ focus: z.string().min(1), process: z.array(z.string()).min(1), conclusion: z.string().min(1) }),
      sideEffects: sideEffects({ writesFileSystem: true }),
      async execute(input) {
        const id = await memoryRequired().appendResearchLog({ focus: input.focus, process: input.process, conclusion: input.conclusion });
        return ok(`Appended research log ${id}.`, { id });
      },
    },
  ];
}

export function createLiveTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const liveRequired = (): LiveRuntime => {
    if (!deps.live) throw new Error("Live runtime is not configured.");
    return deps.live;
  };

  return [
    {
      name: "live.status",
      title: "Live Status",
      description: "Read live status.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      async execute() { return ok("Live status read.", { status: await liveRequired().getStatus() }); },
    },
    liveActionTool("live.set_caption", "Set Caption", z.object({ text: z.string().min(1) }), async (live, input) => live.setCaption(input.text)),
    liveActionTool("live.stream_caption", "Stream Caption", z.object({ text: z.string().min(1), speaker: z.string().optional(), rate_ms: z.number().int().optional().default(34) }), async (live, input) => live.streamCaption(input.text, input.speaker, input.rate_ms)),
    livePanelEventTool("live.panel.push_event", "Push Live Panel Event"),
    livePanelEventTool("live.push_event", "Push Event"),
    liveActionTool("live.trigger_motion", "Trigger Motion", z.object({ group: z.string().min(1), priority: z.enum(["normal", "force"]).optional().default("normal") }), async (live, input) => live.triggerMotion(input.group, input.priority as any)),
    liveActionTool("live.set_expression", "Set Expression", z.object({ expression: z.string().min(1) }), async (live, input) => live.setExpression(input.expression)),
    {
      name: "live.stop_output",
      title: "Stop Output",
      description: "Stop all current live stage output (audio, TTS, caption).",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }),
      async execute() {
        const live = liveRequired();
        await Promise.all([live.clearCaption(), live.stopAudio()]);
        return ok("Stopped all stage output.");
      },
    },
    {
      name: "live.stream_tts_caption",
      title: "Stream TTS",
      description: "Synthesize speech and display caption simultaneously.",
      authority: "external_write",
      inputSchema: z.object({ text: z.string().min(1), voice_name: z.string().optional(), speaker: z.string().optional(), rate_ms: z.number().int().optional().default(34) }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, consumesBudget: true, affectsUserState: true }),
      async execute(input) {
        const live = liveRequired();
        const result = await live.playTtsStream(input.text, { voice: input.voice_name, speaker: input.speaker ?? "Stelle", rateMs: input.rate_ms });
        return ok(result.summary, { result });
      },
    },
    {
      name: "obs.status",
      title: "OBS Status",
      description: "Check if OBS websocket is connected.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute() { return ok("OBS status read.", { status: (await liveRequired().getStatus()).obs }); },
    },
    {
      name: "obs.start_stream",
      title: "Start OBS Stream",
      description: "Start streaming through OBS WebSocket.",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute() {
        const result = await liveRequired().obs.startStream();
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
    {
      name: "obs.stop_stream",
      title: "Stop OBS Stream",
      description: "Stop streaming through OBS WebSocket.",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute() {
        const result = await liveRequired().obs.stopStream();
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
    {
      name: "obs.set_scene",
      title: "Set OBS Scene",
      description: "Switch the current OBS program scene.",
      authority: "external_write",
      inputSchema: z.object({ scene_name: z.string().min(1) }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const result = await liveRequired().obs.setCurrentScene(input.scene_name);
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
  ];

  function liveActionTool<TSchema extends z.AnyZodObject>(name: string, title: string, inputSchema: TSchema, action: (live: LiveRuntime, input: z.infer<TSchema>) => Promise<{ ok: boolean; summary: string }>): ToolDefinition<TSchema> {
    return { name, title, description: title, authority: "external_write", inputSchema, sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }), async execute(input) {
      const result = await action(liveRequired(), input);
      return { ok: result.ok, summary: result.summary, data: { result }, sideEffects: [{ type: name, summary: result.summary, visible: true, timestamp: Date.now() }] };
    }};
  }

  function livePanelEventTool(name: string, title: string): ToolDefinition {
    return liveActionTool(
      name,
      title,
      z.object({
        event_id: z.string().optional(),
        lane: z.enum(["incoming", "response", "topic", "system"]),
        text: z.string().min(1),
        user_name: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        note: z.string().optional(),
      }),
      async (live, input) => live.pushEvent({
        eventId: input.event_id,
        lane: input.lane,
        text: input.text,
        userName: input.user_name,
        priority: input.priority,
        note: input.note,
      })
    );
  }
}

export function createTtsTools(provider: StreamingTtsProvider): ToolDefinition[] {
  return [
    {
      name: "tts.live_speech",
      title: "Live Speech",
      description: "Synthesize live speech using the configured TTS provider and save to files.",
      authority: "safe_write",
      inputSchema: z.object({
        text: z.string().min(1),
        output_dir: z.string().optional(),
        file_prefix: z.string().optional(),
        voice_name: z.string().optional(),
        language: z.string().optional(),
        instructions: z.string().optional(),
        model: z.string().optional(),
        stream: z.boolean().optional(),
      }),
      sideEffects: sideEffects({ writesFileSystem: true, networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const artifacts = await provider.synthesizeToFiles(input.text, {
          outputDir: input.output_dir,
          filePrefix: input.file_prefix,
          voiceName: input.voice_name,
          language: input.language,
          instructions: input.instructions,
          model: input.model,
          stream: input.stream,
        });
        return ok(`${getConfiguredTtsProviderName()} wrote ${artifacts.length} audio artifact(s).`, { artifacts });
      },
    },
    {
      name: "tts.kokoro_speech",
      title: "Kokoro Speech",
      description: "Backward-compatible alias for configured live speech synthesis.",
      authority: "safe_write",
      inputSchema: z.object({ text: z.string().min(1), output_dir: z.string().optional(), file_prefix: z.string().optional(), voice_name: z.string().optional() }),
      sideEffects: sideEffects({ writesFileSystem: true, networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const artifacts = await provider.synthesizeToFiles(input.text, { outputDir: input.output_dir, filePrefix: input.file_prefix, voiceName: input.voice_name });
        return ok(`${getConfiguredTtsProviderName()} wrote ${artifacts.length} audio artifact(s).`, { artifacts });
      },
    },
  ];
}

function workspacePath(context: ToolContext, filePath?: string): string {
  const cwd = path.resolve(context.cwd);
  const target = path.resolve(cwd, filePath ?? ".");
  if (target !== cwd && !target.startsWith(cwd + path.sep)) throw new Error(`Path is outside workspace: ${target}`);
  return target;
}

async function duckDuckGoHtmlSearch(query: string, count: number): Promise<any[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  
  // 模拟浏览器访问，DDG HTML 版对 User-Agent 有要求
  const response = await fetch(url, { 
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    } 
  });

  if (!response.ok) throw new Error(`DDG search failed: ${response.status}`);
  const html = await response.text();
  
  const results: any[] = [];
  // 正则匹配 DDG HTML 版的结果区块
  const resultRegex = /<a class="result__a" rel="noopener" href="([^"]+)">([^<]+)<\/a>.*?<a class="result__snippet"[^>]*>([^<]+)<\/a>/gs;
  
  let match;
  while ((match = resultRegex.exec(html)) !== null && results.length < count) {
    const rawUrl = match[1];
    const title = match[2].trim();
    const snippet = match[3].trim();
    
    // DDG 结果 URL 有时是重定向格式 /l/?kh=-1&uddg=https://...
    const finalUrl = normalizeDuckDuckGoUrl(rawUrl);
    if (finalUrl) {
      results.push({ title, url: finalUrl, snippet });
    }
  }

  return results;
}

async function fetchPublicUrl(url: URL): Promise<Response> {
  let current = url;
  for (let i = 0; i <= 5; i++) {
    const blocked = await validatePublicHttpUrl(current);
    if (blocked) throw new Error(blocked.summary);

    const response = await fetch(current, {
      headers: { "User-Agent": "Stelle/1.0 (Bot; Research-Agent)" },
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current);
  }
  throw new Error("Too many redirects.");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuckDuckGoUrl(rawUrl: string): string | null {
  if (rawUrl.startsWith("http")) return rawUrl;
  try {
    const u = new URL(rawUrl, "https://duckduckgo.com");
    return u.searchParams.get("uddg");
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await import("node:fs/promises").then(f => f.rename(temp, file));
}
