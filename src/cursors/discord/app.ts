/**
 * OpenClaw — TypeScript 移植自 reference.py（discord.js + OpenAI SDK）
 * 结构按原文件分段，未做过度拆分。
 */
import {
  AttachmentBuilder,
  Client,
  ColorResolvable,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  GuildMember,
  Locale,
  Message,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Team,
  TextBasedChannel,
  User,
} from "discord.js";
import dotenv from "dotenv";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import OpenAI, { APIError } from "openai";
import YAML from "yaml";
import type { AgentStatusUpdate } from "../../agent/types.js";
import { buildToolAgentPrompt } from "../../agent/prompt.js";
import { runAgentLoop } from "../../agent/runner.js";
import { stelle } from "../../core/runtime.js";
import {
  DiscordCursorController,
  handleDiscordSlash,
} from "./index.js";
import { setDiscordToolClient } from "./toolRuntime.js";
import {
  getMinecraftConfigFromEnv,
  getMinecraftCursor,
} from "../minecraft/index.js";
import { type DiscordRuntimeDeps } from "./runtime.js";
import { createToolRegistry } from "../../tools/index.js";

dotenv.config();

// ==========================================
// 1. 配置与初始化
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_API_KEY =
  process.env.AISTUDIO_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = "gemma-4-31b-it";
const DEFAULT_BASE_URL =
  process.env.AISTUDIO_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai/";

if (!TOKEN || !DEFAULT_API_KEY) {
  throw new Error(
    "? 缺少环境变量: 请确保 DISCORD_TOKEN 和 AISTUDIO_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY 已配置。"
  );
}

const DEBUG_LOG_CHANNEL_ID = "1493818037999243445";
const MEMORY_DIR = "memories";
const CHANNEL_MEMORY_DIR = path.join(MEMORY_DIR, "channels");
const USER_MEMORY_DIR = path.join(MEMORY_DIR, "users");
const INDEX_PATH = path.join(MEMORY_DIR, "index.json");
const CONFIG_PATH = "config.yaml";

async function ensureDirs(): Promise<void> {
  for (const p of [CHANNEL_MEMORY_DIR, USER_MEMORY_DIR]) {
    if (!existsSync(p)) await mkdir(p, { recursive: true });
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [Partials.Channel, Partials.Message],
});
setDiscordToolClient(client);

const toolRegistry = createToolRegistry();

const ownerIds = new Set<string>();

function getBotId(): string {
  return client.user?.id ?? "0";
}

// ----------------- 通用异步文件 IO -----------------
async function readFileUtf8(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function writeFileUtf8(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, "utf-8");
}

// ----------------- 简单异步锁 -----------------
class AsyncLock {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.locked = false;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// ==========================================
// 2. 配置管理
// ==========================================
const DEFAULT_GUILD_CONFIG = {
  model: DEFAULT_MODEL,
  api_key: "",
  base_url: DEFAULT_BASE_URL,
} as const;

const DEFAULT_CHANNEL_CONFIG = {
  review_msg_threshold: 50,
  distill_review_threshold: 5,
  history_maxlen: 80,
  max_input_chars: 6000,
  max_input_tokens_total: 8000,
  authorized_users: [] as string[],
  activated: false,
};

const fileLock = new AsyncLock();
const userFileLock = new AsyncLock();

type YamlRoot = {
  guilds?: Record<string, Record<string, unknown>>;
  channels?: Record<string, Record<string, unknown>>;
};

let configCache: YamlRoot = {};
const clientsCache = new Map<string, OpenAI>();

async function initConfig(): Promise<void> {
  const content = await readFileUtf8(CONFIG_PATH);
  try {
    configCache = (content ? YAML.parse(content) : {}) as YamlRoot;
  } catch (e) {
    console.error(`? [Config] 解析失败:`, e);
    configCache = {};
  }
}

function getGuildConfig(guildId: string): Record<string, unknown> {
  const g = configCache.guilds?.[guildId] ?? {};
  return { ...DEFAULT_GUILD_CONFIG, ...g };
}

async function setGuildConfig(
  guildId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await fileLock.runExclusive(async () => {
    const rawText = (await readFileUtf8(CONFIG_PATH)) ?? "";
    const raw = (rawText ? YAML.parse(rawText) : {}) as YamlRoot;
    if (!raw.guilds) raw.guilds = {};
    if (!raw.guilds[guildId]) raw.guilds[guildId] = {};
    Object.assign(raw.guilds[guildId], updates);
    await writeFileUtf8(CONFIG_PATH, YAML.stringify(raw));
    configCache = raw;
  });
}

function getChannelConfig(channelId: string): typeof DEFAULT_CHANNEL_CONFIG & {
  [k: string]: unknown;
} {
  const c = configCache.channels?.[channelId] ?? {};
  return { ...DEFAULT_CHANNEL_CONFIG, ...c } as typeof DEFAULT_CHANNEL_CONFIG & {
    [k: string]: unknown;
  };
}

async function setChannelConfig(
  channelId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await fileLock.runExclusive(async () => {
    const rawText = (await readFileUtf8(CONFIG_PATH)) ?? "";
    const raw = (rawText ? YAML.parse(rawText) : {}) as YamlRoot;
    if (!raw.channels) raw.channels = {};
    if (!raw.channels[channelId]) raw.channels[channelId] = {};
    Object.assign(raw.channels[channelId], updates);
    await writeFileUtf8(CONFIG_PATH, YAML.stringify(raw));
    configCache = raw;
  });
}

function isAuthorized(member: GuildMember | null, user: User, channelId: string): boolean {
  const uid = user.id;
  if (ownerIds.has(uid)) return true;
  if (member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const cfg = getChannelConfig(channelId);
  const list = (cfg.authorized_users as string[]) ?? [];
  return list.includes(uid);
}

function getLlmConfig(
  guildId: string | null,
  userId?: string | null
): Record<string, unknown> {
  if (guildId) return getGuildConfig(guildId);
  if (userId) {
    for (const g of client.guilds.cache.values()) {
      if (g.members.cache.has(userId)) return getGuildConfig(g.id);
    }
  }
  return { ...DEFAULT_GUILD_CONFIG };
}

function getLocalClient(guildId: string | null, userId?: string | null): OpenAI {
  const cfg = getLlmConfig(guildId, userId);
  const apiKey = (cfg.api_key as string) || DEFAULT_API_KEY;
  const baseUrl =
    (cfg.base_url as string) || DEFAULT_BASE_URL;
  const cacheKey = `${apiKey}|${baseUrl}`;
  let c = clientsCache.get(cacheKey);
  if (!c) {
    c = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 120_000 });
    clientsCache.set(cacheKey, c);
  }
  return c;
}

// ==========================================
// 3. 辅助工具
// ==========================================
function truncateText(text: unknown, limit = 900): string {
  const s =
    typeof text === "object"
      ? JSON.stringify(text)
      : String(text ?? "");
  return s.length > limit ? s.slice(0, limit) + "\n...(截断)" : s;
}

function parseJson(text: string): Record<string, unknown> {
  let cleaned = text
    .trim()
    .replace(/^```[a-zA-Z]*\n|\n```$/gm, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function estimateTokens(text: string): number {
  return Buffer.byteLength(text, "utf8") / 3 + text.length / 2;
}

function isLikelySpam(
  text: string,
  maxChars: number
): { spam: boolean; reason: string } {
  if (text.length > maxChars)
    return { spam: true, reason: `超过 ${maxChars} 字符` };
  if (text.length > 100) {
    const counts = new Map<string, number>();
    for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    if (maxCount / text.length > 0.6)
      return { spam: true, reason: "大量重复字符" };
  }
  const lower = text.toLowerCase();
  const pats = [
    /ignore (all |previous |above )/i,
    /你现在是/,
    /forget (your |all )/i,
    /system\s*prompt/i,
    /<\|.*?\|>/,
  ];
  for (const pat of pats) {
    if (pat.test(lower))
      return { spam: true, reason: `疑似prompt注入: ${pat.source}` };
  }
  return { spam: false, reason: "" };
}

function safeJsonStringify(v: unknown, space = 2): string {
  try {
    return JSON.stringify(
      v,
      (_k, val) => (typeof val === "bigint" ? val.toString() : val),
      space
    );
  } catch {
    return String(v);
  }
}

/**
 * 将任意异常展开为可读文本（含 HTTP 状态、上游 JSON、堆栈），便于排查 OpenRouter/OpenAI 兼容接口问题。
 */
function formatDetailedError(err: unknown): string {
  const lines: string[] = [];

  if (err instanceof APIError) {
    lines.push("=== OpenAI SDK APIError（或兼容 Base URL）===");
    lines.push(`HTTP: ${String(err.status ?? "无")}`);
    if (err.request_id) lines.push(`request_id: ${err.request_id}`);
    if (err.type) lines.push(`type: ${err.type}`);
    if (err.code != null) lines.push(`code: ${String(err.code)}`);
    if (err.param) lines.push(`param: ${err.param}`);
    lines.push(`message: ${err.message}`);
    lines.push("--- error 字段（服务端返回体，通常含真正原因）---");
    lines.push(safeJsonStringify(err.error));
    lines.push("--- stack ---");
    lines.push(err.stack ?? "(无)");
    return lines.join("\n");
  }

  if (err instanceof AggregateError) {
    lines.push(`=== AggregateError ===`);
    lines.push(`message: ${err.message}`);
    err.errors.forEach((sub, i) => {
      lines.push(`--- 子错误 #${i} ---`);
      lines.push(formatDetailedError(sub));
    });
    return lines.join("\n");
  }

  if (err instanceof Error) {
    lines.push(`=== ${err.name} ===`);
    lines.push(`message: ${err.message}`);
    if (err.cause !== undefined) {
      lines.push("--- cause ---");
      lines.push(formatDetailedError(err.cause));
    }
    lines.push("--- stack ---");
    lines.push(err.stack ?? "(无)");
    return lines.join("\n");
  }

  if (typeof err === "object" && err !== null) {
    lines.push("=== 非标准 Error 对象 ===");
    lines.push(safeJsonStringify(err));
    return lines.join("\n");
  }

  return String(err);
}

/**
 * Discord Embed 总长约 6000；描述 + 少量续页字段，避免超限。
 */
function splitForDiscordLog(text: string): {
  description: string;
  fields: [string, string, boolean][];
} {
  const maxDesc = 3800;
  const maxField = 1000;
  const maxExtraFields = 4;
  const description = text.slice(0, maxDesc);
  const fields: [string, string, boolean][] = [];
  let pos = maxDesc;
  let n = 0;
  while (pos < text.length && n < maxExtraFields) {
    fields.push([
      `续 ${n + 1}/${Math.ceil(text.length / maxField)}`,
      text.slice(pos, pos + maxField),
      false,
    ]);
    pos += maxField;
    n += 1;
  }
  if (pos < text.length) {
    fields.push([
      "仍有截断",
      `全文共 ${text.length} 字符；完整内容已写入本机终端日志（console.error）。`,
      false,
    ]);
  }
  return { description, fields };
}

async function sendLogDetailed(
  title: string,
  err: unknown,
  color: ColorResolvable = Colors.Red
): Promise<void> {
  const full = formatDetailedError(err);
  console.error(`[${title}]`, full);
  const { description, fields } = splitForDiscordLog(full);
  await sendLogEmbed(title, description, color, fields);
}

async function sendLogEmbed(
  title: string,
  description = "",
  color: ColorResolvable = Colors.Blue,
  fields: [string, string, boolean][] = []
): Promise<void> {
  const logChannel = await client.channels.fetch(DEBUG_LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel?.isSendable()) return;
  // discord.js Embed：description 须为 null/undefined 或长度 ≥1，空字符串会触发 shapeshift 校验错误
  const desc = description.slice(0, 4000);
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp(new Date());
  if (desc.length > 0) embed.setDescription(desc);
  for (const [name, value, inline] of fields) {
    const v = value.slice(0, 1000);
    embed.addFields({
      name: name.slice(0, 256),
      value: v.length > 0 ? v : "\u200b",
      inline,
    });
  }
  try {
    await logChannel.send({ embeds: [embed] });
  } catch (e) {
    console.error(`[DebugLog] 发送失败:`, e);
  }
}

async function formatMessage(
  msg: Message,
  nickname: string,
  lastAuthorId: string,
  lastMsgTime: number
): Promise<{ lines: string[]; authorId: string; ts: number }> {
  const parts: string[] = [];

  if (msg.reference?.messageId) {
    try {
      const refMsg = await msg.fetchReference();
      const refNick =
        refMsg.author.id === getBotId()
          ? "[OpenClaw]"
          : UserIndex.getName(msg.guildId, refMsg.author.id);
      parts.push(
        `[Reply to ${refNick}(ID:${refMsg.author.id})]`
      );
    } catch {
      /* ignore */
    }
  }

  if (msg.cleanContent) parts.push(msg.cleanContent.slice(0, 2000));
  for (const e of msg.embeds) {
    parts.push(
      `[Embed: ${e.title ?? ""}] ${(e.description ?? "").slice(0, 300)}`
    );
  }

  const text = parts.join(" ").trim();
  const nowTs = msg.createdTimestamp / 1000;
  const lines: string[] = [];
  if (
    msg.author.id !== lastAuthorId ||
    nowTs - lastMsgTime > 120
  ) {
    const timeStr = msg.createdAt.toLocaleString();
    const nameLabel =
      msg.author.id === getBotId()
        ? `[OpenClaw](ID:${getBotId()})`
        : `${nickname}(ID:${msg.author.id})`;
    lines.push(`--- ${nameLabel} (${timeStr}) ---`);
  }
  if (text) lines.push(text);
  for (const a of msg.attachments.values()) lines.push(a.url);
  return { lines, authorId: msg.author.id, ts: nowTs };
}

async function sendChunks(
  channel: TextBasedChannel,
  text: string,
  chunkSize = 2000,
  asEmbed = false
): Promise<Message[]> {
  const msgs: Message[] = [];
  if (!channel.isSendable()) return msgs;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    if (asEmbed) {
      const desc = chunk.length > 0 ? chunk : "\u200b";
      msgs.push(
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setDescription(desc.slice(0, 4096))
              .setColor(Colors.Aqua),
          ],
        })
      );
    } else {
      msgs.push(await channel.send({ content: chunk }));
    }
  }
  return msgs;
}

function buildStatusLine(update: AgentStatusUpdate): string {
  switch (update.phase) {
    case "start":
      return "Started request processing.";
    case "round":
      return `Thinking round ${update.round ?? "?"}.`;
    case "tool_start":
      return `Calling tool: ${update.toolName ?? "unknown"}`;
    case "tool_end":
      return `Tool finished: ${update.toolName ?? "unknown"}`;
    case "done":
      return "Final response generated.";
    case "error":
      return update.message ?? "Agent execution failed.";
    default:
      return update.message ?? "Processing.";
  }
}

async function getDebugSendTarget() {
  const channel = await client.channels.fetch(DEBUG_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isSendable()) return null;
  return channel;
}

function createDebugStatusReporter(source: {
  requester?: User | null;
  channel: TextBasedChannel;
}) {
  let statusMessage: Message | null = null;
  const steps: string[] = [];

  return async (update: AgentStatusUpdate): Promise<void> => {
    try {
      const debugChannel = await getDebugSendTarget();
      if (!debugChannel) return;

      const line = buildStatusLine(update);
      steps.push(`- ${line}`);
      const recent = steps.slice(-8).join("\n").slice(0, 1000) || "- Waiting";
      const color =
        update.phase === "error"
          ? Colors.Red
          : update.phase === "done"
            ? Colors.Green
            : Colors.Blurple;
      const title =
        update.phase === "done"
          ? "OpenClaw Finished"
          : update.phase === "error"
            ? "OpenClaw Error"
            : "OpenClaw Running";

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .addFields(
          { name: "Phase", value: line.slice(0, 1024) || "\u200b" },
          { name: "Recent Steps", value: recent || "\u200b" },
          {
            name: "Source",
            value: `channel=${source.channel.id}\nuser=${source.requester?.id ?? "unknown"}`,
          }
        )
        .setTimestamp(new Date());

      if (!statusMessage) {
        statusMessage = await debugChannel.send({ embeds: [embed] });
      } else {
        statusMessage = await statusMessage.edit({ embeds: [embed] });
      }
    } catch {
      // Ignore status-reporting failures so they do not block the main path.
    }
  };
}

function createDebugAttachmentSender(source: {
  requester?: User | null;
  channel: TextBasedChannel;
}) {
  return async (filePath: string, caption?: string): Promise<string | void> => {
    const debugChannel = await getDebugSendTarget();
    if (!debugChannel) return;
    const attachment = new AttachmentBuilder(filePath);
    await debugChannel.send({
      content: [
        caption ?? "Attachment",
        `source_channel=${source.channel.id}`,
        `source_user=${source.requester?.id ?? "unknown"}`,
      ].join("\n"),
      files: [attachment],
    });
    return `Uploaded file to debug channel ${DEBUG_LOG_CHANNEL_ID}`;
  };
}

// ==========================================
// 4. 用户索引
// ==========================================
class UserIndex {
  private static readonly lock = new AsyncLock();
  private static guilds: Record<string, Record<string, string>> = {};
  private static globals: Record<string, string> = {};

  static async init(): Promise<void> {
    const content = await readFileUtf8(INDEX_PATH);
    if (!content) return;
    try {
      const data = JSON.parse(content) as {
        guilds?: Record<string, Record<string, string>>;
        globals?: Record<string, string>;
      };
      UserIndex.guilds = data.guilds ?? {};
      UserIndex.globals = data.globals ?? {};
    } catch {
      /* ignore */
    }
  }

  static async save(): Promise<void> {
    await writeFileUtf8(
      INDEX_PATH,
      JSON.stringify(
        { guilds: UserIndex.guilds, globals: UserIndex.globals },
        null,
        0
      )
    );
  }

  static async getOrCreateNickname(msg: Message): Promise<string> {
    const uid = msg.author.id;
    const dName = msg.member?.displayName ?? msg.author.displayName ?? msg.author.username;
    if (UserIndex.globals[uid] !== dName) {
      await UserIndex.lock.runExclusive(async () => {
        UserIndex.globals[uid] = dName;
        await UserIndex.save();
      });
    }

    if (!msg.guildId) return dName;

    const gid = msg.guildId;
    return UserIndex.lock.runExclusive(async () => {
      const guildNicks = UserIndex.guilds[gid] ?? {};
      UserIndex.guilds[gid] = guildNicks;
      if (uid in guildNicks) return guildNicks[uid]!;

      let baseNick = dName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, "").trim();
      if (!baseNick) baseNick = `User_${uid.slice(0, 4)}`;
      let newNick = baseNick;
      const used = new Set(Object.values(guildNicks));
      let c = 2;
      while (used.has(newNick)) {
        newNick = `${baseNick}(${c})`;
        c += 1;
      }
      guildNicks[uid] = newNick;
      await UserIndex.save();
      return newNick;
    });
  }

  static getName(guildId: string | null, userId: string): string {
    const uid = userId;
    const globalName = UserIndex.globals[uid] ?? uid;
    if (!guildId) return globalName;
    return UserIndex.guilds[guildId]?.[uid] ?? globalName;
  }

  static buildMappingText(
    guildId: string | null,
    userIds: string[]
  ): string {
    if (!guildId) return "(DM Mode, no mapping needed)";
    return userIds
      .map((uid) => `${UserIndex.getName(guildId, uid)} = UserID ${uid}`)
      .join("\n");
  }

  static search(kw: string): [string, string][] {
    const k = kw.toLowerCase();
    const res: [string, string][] = [];
    for (const [uid, gName] of Object.entries(UserIndex.globals)) {
      const nicks = Object.keys(UserIndex.guilds)
        .filter((g) => uid in (UserIndex.guilds[g] ?? {}))
        .map((g) => UserIndex.guilds[g]![uid]!);
      const allNames = [gName, ...nicks.filter(Boolean)];
      if (
        uid.includes(k) ||
        allNames.some((n) => n.toLowerCase().includes(k))
      ) {
        res.push([
          uid,
          `全局名:${gName} | 各群专属名:${nicks.length ? [...new Set(nicks)].join("/") : "无"}`,
        ]);
      }
    }
    return res;
  }
}

// ==========================================
// 5. 提示词定义
// ==========================================
function buildJudgePrompt(isDm: boolean): string {
  const botId = getBotId();
  const base = `You are OpenClaw (User ID: ${botId}). You MUST output valid JSON ONLY:
{
  "think": "Short inner monologue analyzing the current vibe", "focus": {"topic": "Current conversation topic", "drifted": false},
  "trigger": {"fire_now": false, "condition_type": "silence|keyword|gap|never", "condition_value": 15, "expires_after": 120},
  "intent": {"stance": "playful|snarky|question|inform|react|pass", "angle": "Description of intervention angle"}, "recall_user_id": null
}
1. Identity: If your name or ID is mentioned, decisively set fire_now: true. 2. Recognize users by ID, names are just aliases.`;

  const recallRule =
    "\n5. Memory Recall: Fill in the strongly related member ID (if the topic is about yourself, fill in your own ID) or null.";
  if (isDm)
    return (
      base +
      "3. This is [DM Mode], focus on 1-on-1 chat, set fire_now: true directly unless no reply is needed." +
      recallRule
    );
  return (
    base +
    "3. Do not interfere with others' private chats. 4. Maintain topic heat during awkward silences." +
    recallRule
  );
}

function buildCharacterPrompt(isDm: boolean): string {
  const env = isDm ? "DM partner" : "group member";
  return `You are ${env} OpenClaw (User ID: ${getBotId()}).
[Personality] Chill, authentic, a bit lazy but playful. You are a peer, NOT a stiff assistant.
[Rules] Reply in the user's language; 1-3 sentences; sparse emojis; no formal language. Read the room: if the vibe is lighthearted, play along with harmless jokes, teasing, or silly requests (like roleplaying or counting) in your own casual way. NEVER expose your AI identity.
[Advanced Format] For professional/long content (code/math/analysis, etc.), STRICTLY wrap it in <embed>detailed content</embed>. Outside the tag, leave ONLY one minimal summary sentence!`;
}

const MEMORY_REVIEW_PROMPT = `You are OpenClaw. Review the chat history and extract important events.
Output pure JSON ONLY: {"events": [{"summary": "Description including (ID:xxxx)", "related_user_id": "User ID", "event_time": "YYYY-MM-DD HH:MM", "category": "Category"}]}`;

const MEMORY_DISTILL_PROMPT =
  "You are OpenClaw. Distill an overall global impression of ID:{user_id} based on these events. Write 3-5 colloquial sentences. Include the timestamp. Leave empty if insignificant.";

// ==========================================
// 6. 记忆管理器
// ==========================================
class MemoryManager {
  private readonly mdPath: string;
  private readonly writeLock = new AsyncLock();

  constructor(
    readonly channelId: string,
    public guildId: string | null,
    public dmUserId: string | null
  ) {
    this.mdPath = path.join(CHANNEL_MEMORY_DIR, `${channelId}.md`);
  }

  private async readSections(): Promise<Record<string, string>> {
    const content = (await readFileUtf8(this.mdPath)) ?? "";
    const keys = ["历史事件", "短期进程"] as const;
    const out: Record<string, string> = {};
    for (const s of keys) {
      const re = new RegExp(
        `# ${s}\\n+(.*?)(?=\\n+---|\\n+# |$)`,
        "s"
      );
      const m = content.match(re);
      out[s] = m?.[1]?.trim() ?? "";
    }
    return out;
  }

  /** 供 slash / distill 读取「历史事件」区块 */
  async getHistoryEventsText(): Promise<string> {
    const secs = await this.readSections();
    return secs["历史事件"] ?? "";
  }

  async loadContext(
    guildId: string | null,
    userId?: string | null
  ): Promise<string> {
    const parts: string[] = [];
    if (userId) {
      const ucontent =
        (await readFileUtf8(path.join(USER_MEMORY_DIR, `${userId}.md`))) ??
        "";
      const m = ucontent.match(/## 人物印象\n+(.*)/s);
      const imp = m?.[1]?.trim();
      if (imp) {
        const nick =
          userId === getBotId()
            ? "Yourself(OpenClaw)"
            : UserIndex.getName(guildId, userId);
        parts.push(`[Global profile for ${nick}(ID:${userId})]\n${imp}`);
      }
    }
    const secs = await this.readSections();
    const evRaw = secs["历史事件"] ?? "";
    const events = evRaw
      .split("\n\n")
      .map((e) => e.trim())
      .filter(Boolean);
    if (events.length)
      parts.push(`[Recent Events]\n` + events.slice(-10).join("\n\n"));
    return parts.join("\n\n");
  }

  async runReview(
    recentHistory: string[],
    reviewCount: number,
    source = "AUTO"
  ): Promise<boolean> {
    if (!recentHistory.length) return true;
    const llmCfg = getLlmConfig(this.guildId, this.dmUserId);
    const model = String(llmCfg.model ?? DEFAULT_MODEL);
    try {
      const resp = await getLocalClient(this.guildId, this.dmUserId).chat.completions.create({
        model,
        messages: [
          { role: "system", content: MEMORY_REVIEW_PROMPT },
          { role: "user", content: recentHistory.join("\n") },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 8192,
      });
      let content = resp.choices[0]?.message?.content ?? "";
      content = content.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
      const events = (parseJson(content).events as unknown[]) ?? [];
      const eventObjs = events
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map((e) => ({
          summary: String(e.summary ?? "无摘要"),
          related_user_id: String(e.related_user_id ?? ""),
          event_time: String(
            e.event_time ??
              new Date()
                .toISOString()
                .slice(0, 16)
                .replace("T", " ")
          ),
        }));
      if (!eventObjs.length) return true;

      let historySnapshot = "";
      await this.writeLock.runExclusive(async () => {
        const secs = await this.readSections();
        const shortEntries = (secs["短期进程"] ?? "")
          .split("\n\n")
          .map((e) => e.trim())
          .filter(Boolean);
        const newEvents: string[] = [];
        for (const ev of eventObjs) {
          const line = `[${ev.event_time}] (相关ID:${ev.related_user_id}) ${ev.summary}`;
          shortEntries.push(line);
          newEvents.push(line);
        }
        secs["短期进程"] = shortEntries.slice(-50).join("\n\n");
        secs["历史事件"] = [secs["历史事件"], ...newEvents]
          .filter(Boolean)
          .join("\n\n");
        historySnapshot = secs["历史事件"] ?? "";
        await writeFileUtf8(
          this.mdPath,
          `# 历史事件\n\n${secs["历史事件"]}\n\n---\n\n# 短期进程\n\n${secs["短期进程"]}\n\n---\n\n`
        );
      });

      if (reviewCount > 0 && reviewCount % 5 === 0) {
        void this.runDistill(historySnapshot);
      }
      return true;
    } catch (e) {
      await sendLogDetailed(`? [Memory Review - ${source}] 异常`, e);
      return false;
    }
  }

  async runDistill(eventText: string): Promise<void> {
    if (!eventText) return;
    const llmCfg = getLlmConfig(this.guildId, this.dmUserId);
    const model = String(llmCfg.model ?? DEFAULT_MODEL);
    const api = getLocalClient(this.guildId, this.dmUserId);
    const ids = new Set(
      [...eventText.matchAll(/ID:(\d+)/g)].map((m) => m[1]!)
    );
    for (const uid of ids) {
      const related = eventText
        .split("\n")
        .filter((line) => line.includes(`ID:${uid}`));
      if (related.length < 3) continue;
      try {
        const resp = await api.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: MEMORY_DISTILL_PROMPT.replace("{user_id}", uid),
            },
            { role: "user", content: related.join("\n") },
          ],
          temperature: 0.5,
          max_tokens: 2048,
        });
        let raw = (resp.choices[0]?.message?.content ?? "").trim();
        raw = raw.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
        if (raw) await this.updateUserImpression(uid, raw);
      } catch (e) {
        console.error(`[MemoryDistill Error] uid=${uid}:`, e);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private async updateUserImpression(
    uid: string,
    impression: string
  ): Promise<void> {
    const userPath = path.join(USER_MEMORY_DIR, `${uid}.md`);
    await userFileLock.runExclusive(async () => {
      let content =
        (await readFileUtf8(userPath)) ??
        `# ID:${uid} 的全局档案\n\n## 人物印象\n\n`;
      const stamp = new Date().toISOString().slice(0, 10);
      const newBlock = `*最后更新：${stamp}*\n${impression}`;
      const pattern = /(## 人物印象\n+).*?(?=\n# |$)/s;
      if (pattern.test(content)) {
        content = content.replace(pattern, `$1${newBlock}\n\n`);
      } else {
        content = `${content}\n\n## 人物印象\n\n${newBlock}\n\n`;
      }
      await writeFileUtf8(userPath, content.trim() + "\n");
    });
  }
}

function isZh(locale: string | null | undefined): boolean {
  return (locale ?? "").startsWith("zh");
}

function loc(locale: string | null | undefined, en: string, zh: string): string {
  return isZh(locale) ? zh : en;
}

const discordRuntimeDeps: DiscordRuntimeDeps = {
  getBotId,
  estimateTokens,
  isLikelySpam,
  sendLogEmbed,
  sendLogDetailed,
  formatMessage,
  sendChunks,
  getLlmConfig,
  getLocalClient,
  parseJson,
  buildJudgePrompt,
  buildCharacterPrompt,
  runAgentLoop,
  buildToolAgentPrompt,
  toolRegistry,
  truncateText,
  getChannelConfig,
  createMemoryManager: (
    channelId: string,
    guildId: string | null,
    dmUserId: string | null
  ) => new MemoryManager(channelId, guildId, dmUserId),
  userIndex: {
    getName: UserIndex.getName.bind(UserIndex),
    getOrCreateNickname: UserIndex.getOrCreateNickname.bind(UserIndex),
    buildMappingText: UserIndex.buildMappingText.bind(UserIndex),
  },
  createStatusReporter: createDebugStatusReporter,
  createAttachmentSender: createDebugAttachmentSender,
};

const discordController = new DiscordCursorController(discordRuntimeDeps);
const discordCursor = discordController.cursor;
const discordSlashDeps = {
  discordController,
  loc,
  isAuthorized,
  forgetUserProfile: async (userId: string): Promise<boolean> => {
    const userPath = path.join(USER_MEMORY_DIR, `${userId}.md`);
    if (!existsSync(userPath)) return false;
    await unlink(userPath);
    return true;
  },
  clearChannelMemory: async (channelId: string): Promise<void> => {
    const channelPath = path.join(CHANNEL_MEMORY_DIR, `${channelId}.md`);
    if (existsSync(channelPath)) {
      await unlink(channelPath);
    }
  },
  getChannelConfig,
  defaultChannelConfig: DEFAULT_CHANNEL_CONFIG,
  setChannelConfig,
  setGuildConfig,
  userIndex: {
    search: UserIndex.search.bind(UserIndex),
    getOrCreateNickname: UserIndex.getOrCreateNickname.bind(UserIndex),
  },
  getBotId,
  formatMessage,
} as const;

export { client, discordController, discordCursor, discordSlashDeps };

stelle.registerWindow(discordCursor);

// ==========================================
// 9. Slash 命令注册与处理
// ==========================================
const slashCommands = [
  new SlashCommandBuilder()
    .setName("shut_up")
    .setDescription(
      "Force the bot to remain completely silent in this channel for 5 minutes."
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "闭嘴",
      [Locale.ChineseTW]: "閉嘴",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "全员可用：让机器人在当前频道强行闭嘴 5 分钟",
      [Locale.ChineseTW]: "全員可用：讓機器人在當前頻道強行閉嘴 5 分鐘",
    }),
  new SlashCommandBuilder()
    .setName("forget_me")
    .setDescription(
      "Erase all of the AI's cross-server global memories about you."
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "遗忘我",
      [Locale.ChineseTW]: "遺忘我",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "清除 AI 对你的所有跨服全局记忆",
      [Locale.ChineseTW]: "清除 AI 對你的所有跨服全域記憶",
    }),
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription(
      "Clear the context and historical memory of the current channel."
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "清空记忆",
      [Locale.ChineseTW]: "清空記憶",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "清空当前频道的上下文与历史记忆",
      [Locale.ChineseTW]: "清空當前頻道的上下文與歷史記憶",
    }),
  new SlashCommandBuilder()
    .setName("memorize")
    .setDescription(
      "Manually force a memory summarization (packing) process."
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "强制记忆",
      [Locale.ChineseTW]: "強制記憶",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "手动强制触发一次记忆打包",
      [Locale.ChineseTW]: "手動強制觸發一次記憶打包",
    }),
  new SlashCommandBuilder()
    .setName("distill")
    .setDescription(
      "Manually force a global character profile distillation."
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "提炼画像",
      [Locale.ChineseTW]: "提煉畫像",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "手动强制触发一次全局人物画像进化",
      [Locale.ChineseTW]: "手動強制觸發一次全域人物畫像進化",
    }),
  new SlashCommandBuilder()
    .setName("activate")
    .setDescription("Activate listening in the current channel.")
    .setNameLocalizations({
      [Locale.ChineseCN]: "激活",
      [Locale.ChineseTW]: "啟動",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "激活当前频道的监听",
      [Locale.ChineseTW]: "啟動當前頻道的監聽",
    }),
  new SlashCommandBuilder()
    .setName("deactivate")
    .setDescription("Deactivate listening in the current channel.")
    .setNameLocalizations({
      [Locale.ChineseCN]: "停用",
      [Locale.ChineseTW]: "停用",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "停止当前频道的监听",
      [Locale.ChineseTW]: "停止當前頻道的監聽",
    }),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "View or modify the listening parameters for the current channel."
    )
    .addStringOption((o) =>
      o
        .setName("key")
        .setDescription("Configuration key / 配置项名称")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("value")
        .setDescription("Configuration value / 新的配置值")
        .setRequired(false)
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "频道配置",
      [Locale.ChineseTW]: "頻道設定",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "查看或修改当前频道的监听参数",
      [Locale.ChineseTW]: "查看或修改當前頻道的監聽參數",
    }),
  new SlashCommandBuilder()
    .setName("set_api")
    .setDescription(
      "Configure the LLM and API for the current server (Model is required)."
    )
    .addStringOption((o) =>
      o
        .setName("model")
        .setDescription("The model name / 模型名称 (e.g. gemma-4-31b-it)")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("api_key")
        .setDescription("Your API Key / API密钥")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("base_url")
        .setDescription("Custom Base URL / 自定义请求地址")
        .setRequired(false)
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "设置api",
      [Locale.ChineseTW]: "設定api",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "为当前服务器配置大模型与API (模型为必填项)",
      [Locale.ChineseTW]: "為當前伺服器設定大模型與API (模型為必填項)",
    }),
  new SlashCommandBuilder()
    .setName("whois")
    .setDescription("Query user ID to nickname mappings.")
    .addStringOption((o) =>
      o
        .setName("keyword")
        .setDescription("User ID or Name to search / 用户ID或名称关键字")
        .setRequired(true)
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "查询用户",
      [Locale.ChineseTW]: "查詢用戶",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "查询用户名对照",
      [Locale.ChineseTW]: "查詢用戶名對照",
    }),
  new SlashCommandBuilder()
    .setName("retrieve_history")
    .setDescription("Trace back and extract memory from channel history.")
    .addIntegerOption((o) =>
      o
        .setName("limit")
        .setDescription("Number of messages to retrieve / 获取的消息数量")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("start_time")
        .setDescription(
          "Start time / 开始时间 (e.g. 2023-12-01 15:30)"
        )
        .setRequired(false)
    )
    .setNameLocalizations({
      [Locale.ChineseCN]: "追溯历史",
      [Locale.ChineseTW]: "追溯歷史",
    })
    .setDescriptionLocalizations({
      [Locale.ChineseCN]: "追溯并提取记忆",
      [Locale.ChineseTW]: "追溯並提取記憶",
    }),
].map((c) => c.toJSON());

// ==========================================
// 10. 事件与入口
// ==========================================

client.once(Events.ClientReady, async (c) => {
  await ensureDirs();
  await initConfig();
  await UserIndex.init();

  const minecraftConfig = getMinecraftConfigFromEnv();
  if (minecraftConfig) {
    const minecraftCursor = getMinecraftCursor();
    await minecraftCursor.connect(minecraftConfig).catch((error) => {
      void sendLogDetailed("Minecraft cursor connect failed", error);
    });
  }

  discordController.bootstrapActivatedChannels(
    Object.keys(configCache.channels ?? {})
  );

  const app = await c.application?.fetch();
  if (app?.owner) {
    if (app.owner instanceof Team) {
      if (app.owner.ownerId) ownerIds.add(app.owner.ownerId);
      for (const tm of app.owner.members.values()) ownerIds.add(tm.user.id);
    } else {
      ownerIds.add(app.owner.id);
    }
  }

  const rest = new REST().setToken(TOKEN);
  await rest.put(Routes.applicationCommands(c.user.id), {
    body: slashCommands,
  });

  console.log(`? OpenClaw 已登录 (ID: ${getBotId()})`);

  setInterval(() => {
    void stelle.runAttentionCycle().catch((error) => {
      void sendLogDetailed("Stelle attention cycle failed", error);
    });
  }, 15_000);

  setInterval(() => {
    discordController.cleanupTypingStates();
  }, 60_000);
});

client.on(Events.TypingStart, async (t) => {
  await stelle.activateCursor(discordCursor.id, {
    type: "typing_start",
    reason: "Discord typing event",
    payload: { typing: t },
    timestamp: Date.now(),
  });
  await stelle.tickCursor(discordCursor.id);
});

client.on(Events.MessageCreate, async (msg) => {
  await stelle.activateCursor(discordCursor.id, {
    type: "message_create",
    reason: "Discord message event",
    payload: { message: msg },
    timestamp: Date.now(),
  });
  await stelle.tickCursor(discordCursor.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  await handleDiscordSlash(interaction, discordSlashDeps);
});

await client.login(TOKEN);

