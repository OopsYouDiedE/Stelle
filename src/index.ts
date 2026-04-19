/**
 * OpenClaw — TypeScript 移植自 reference.py（discord.js + OpenAI SDK）
 * 结构按原文件分段，未做过度拆分。
 */
import {
  ChannelType,
  ChatInputCommandInteraction,
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

dotenv.config();

// ==========================================
// 1. 配置与初始化
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const DEFAULT_API_KEY =
  process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;

if (!TOKEN || !DEFAULT_API_KEY) {
  throw new Error(
    "❌ 缺少环境变量: 请确保 DISCORD_TOKEN 和 OPENAI_API_KEY (或 OPENROUTER_API_KEY) 已配置。"
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
  model: "gpt-4o-mini",
  api_key: "",
  base_url: "https://api.openai.com/v1",
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
    console.error(`❌ [Config] 解析失败:`, e);
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
    (cfg.base_url as string) || "https://api.openai.com/v1";
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
    const model = String(llmCfg.model ?? "gpt-4o-mini");
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
      await sendLogDetailed(`❌ [Memory Review - ${source}] 异常`, e);
      return false;
    }
  }

  async runDistill(eventText: string): Promise<void> {
    if (!eventText) return;
    const llmCfg = getLlmConfig(this.guildId, this.dmUserId);
    const model = String(llmCfg.model ?? "gpt-4o-mini");
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

// ==========================================
// 7. 核心频道管理
// ==========================================
class ChannelManager {
  static instances = new Map<string, ChannelManager>();

  static get(cid: string): ChannelManager {
    let m = ChannelManager.instances.get(cid);
    if (!m) {
      m = new ChannelManager(cid);
      ChannelManager.instances.set(cid, m);
    }
    return m;
  }

  readonly history: string[] = [];
  readonly activeUsers = new Map<string, number>();
  focus: string | null = null;
  waitCond: Record<string, unknown> | null = null;
  msgCount = 0;
  lastMsgTime = Date.now() / 1000;
  timerTask: ReturnType<typeof setTimeout> | null = null;
  lastAuthorId = "0";
  isProcessing = false;
  shutUpUntil = 0;
  msgCountSinceReview = 0;
  reviewCountSinceDistill = 0;
  private mem: MemoryManager | null = null;

  constructor(readonly channelId: string) {}

  public guildId: string | null = null;
  public dmUserId: string | null = null;

  get memoryManager(): MemoryManager {
    if (!this.mem)
      this.mem = new MemoryManager(
        this.channelId,
        this.guildId,
        this.dmUserId
      );
    else {
      this.mem.guildId = this.guildId;
      this.mem.dmUserId = this.dmUserId;
    }
    return this.mem;
  }

  get cfg(): ReturnType<typeof getChannelConfig> {
    return getChannelConfig(this.channelId);
  }

  trimHistoryByTokens(): void {
    let total = this.history.reduce(
      (s, line) => s + estimateTokens(line),
      0
    );
    const maxT = Number(this.cfg.max_input_tokens_total ?? 8000);
    while (this.history.length && total > maxT) {
      const first = this.history.shift()!;
      total -= estimateTokens(first);
    }
  }

  async parseMsg(msg: Message): Promise<boolean> {
    if (!this.guildId && msg.guildId) this.guildId = msg.guildId;
    if (!msg.guild && !this.dmUserId && !msg.author.bot)
      this.dmUserId = msg.author.id;

    const content = msg.cleanContent || "";
    const { spam, reason } = isLikelySpam(
      content,
      Number(this.cfg.max_input_chars ?? 6000)
    );
    if (spam) {
      void sendLogEmbed("🛡️ [AntiSpam] 拦截", "", Colors.Blue, [
        ["用户", msg.author.id, false],
        ["原因", reason, false],
      ]);
      return false;
    }

    this.activeUsers.set(msg.author.id, Date.now() / 1000);
    const nick =
      msg.author.id === getBotId()
        ? "[OpenClaw]"
        : await UserIndex.getOrCreateNickname(msg);

    const { lines, authorId, ts } = await formatMessage(
      msg,
      nick,
      this.lastAuthorId,
      this.lastMsgTime
    );
    this.lastAuthorId = authorId;
    this.lastMsgTime = ts;
    for (const ln of lines) this.history.push(ln);
    this.trimHistoryByTokens();

    this.msgCount += 1;
    this.msgCountSinceReview += 1;
    return true;
  }

  extractEmbedAndReply(raw: string): { reply: string; embed: string } {
    const cleaned = raw.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
    const embedMatch = cleaned.match(/<embed>(.*?)(?:<\/embed>|$)/is);
    const embedContent = embedMatch?.[1]?.trim() ?? "";
    const reply = cleaned
      .replace(/<embed>.*?(?:<\/embed>|$)/gis, "")
      .trim();
    return { reply, embed: embedContent };
  }

  async callAi(
    mode: "judge" | "main",
    extra: { intent?: Record<string, unknown>; recall_user_id?: unknown } = {}
  ): Promise<unknown> {
    const isDm = !this.guildId;
    const llmCfg = getLlmConfig(this.guildId, this.dmUserId);
    const now = Date.now() / 1000;
    const activeUids = [...this.activeUsers.entries()]
      .filter(([uid, ts]) => now - ts < 600 && uid !== getBotId())
      .map(([uid]) => uid);
    const participants =
      activeUids.map((u) => UserIndex.getName(this.guildId, u)).join(", ") ||
      "无";
    const uidMap = UserIndex.buildMappingText(
      this.guildId,
      activeUids
    );
    const currUtc = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const api = getLocalClient(this.guildId, this.dmUserId);
    const model = String(llmCfg.model ?? "gpt-4o-mini");

    try {
      if (mode === "judge") {
        const sysP =
          buildJudgePrompt(isDm) + `\n[Time: ${currUtc}]\n[Mapping]\n${uidMap}`;
        const userMsg =
          `Active: ${participants}\nFocus: ${this.focus}\nHistory:\n` +
          this.history.slice(-10).join("\n");
        const resp = await api.chat.completions.create({
          model,
          messages: [
            { role: "system", content: sysP },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2048,
        });
        let judge = resp.choices[0]?.message?.content ?? "";
        judge = judge.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
        return parseJson(judge);
      }

      const intent = (extra.intent ?? {}) as Record<string, unknown>;
      const recallRaw = extra.recall_user_id;
      const recallUid =
        recallRaw === null || recallRaw === undefined
          ? null
          : String(recallRaw);
      const memCtx = await this.memoryManager.loadContext(
        this.guildId,
        recallUid
      );
      const sysP =
        buildCharacterPrompt(isDm) +
        `\n[Time: ${currUtc}]\nActive: ${participants}\n[Mapping]\n${uidMap}` +
        (memCtx ? `\n\nContext:\n${memCtx}` : "");
      const footer = `\n\nAngle: ${intent.angle}, Stance: ${intent.stance}`;
      const userMsg =
        "History:\n" + this.history.slice(-25).join("\n") + footer;

      const resp = await api.chat.completions.create({
        model,
        messages: [
          { role: "system", content: sysP },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      });
      const raw = (resp.choices[0]?.message?.content ?? "").trim();
      const { reply, embed } = this.extractEmbedAndReply(raw);
      const fields: [string, string, boolean][] = [
        ["私聊", String(isDm), true],
        ["输入", truncateText(userMsg), false],
      ];
      if (embed) fields.push(["嵌卡", truncateText(embed), false]);
      await sendLogEmbed("📝 MAIN 日志", "", Colors.Blue, fields);
      return [reply, embed] as const;
    } catch (e) {
      await sendLogDetailed("❌ API 异常", e);
      return null;
    }
  }

  async executeReply(
    channel: TextBasedChannel,
    intent: Record<string, unknown>,
    recallUserId?: string | null
  ): Promise<void> {
    if (intent.stance === "pass" || this.isProcessing) return;
    if (!channel.isSendable()) return;
    this.isProcessing = true;
    this.waitCond = null;
    try {
      await channel.sendTyping().catch(() => {});
      const res = await this.callAi("main", {
        intent,
        recall_user_id: recallUserId ?? null,
      });
      if (!res) return;
      const [reply, embedContent] = res as [string, string];
      let replyText = reply;
      if (!replyText && embedContent)
        replyText = "Detailed content in the card below:";
      const toParse: Message[] = [];
      if (replyText)
        toParse.push(...(await sendChunks(channel, replyText, 2000, false)));
      if (embedContent)
        toParse.push(
          ...(await sendChunks(channel, embedContent, 4000, true))
        );
      for (const m of toParse) await this.parseMsg(m);
    } finally {
      this.isProcessing = false;
    }
  }

  maybeTriggerReview(): void {
    if (
      this.msgCountSinceReview >=
      Number(this.cfg.review_msg_threshold ?? 50)
    ) {
      this.msgCountSinceReview = 0;
      this.reviewCountSinceDistill += 1;
      void this.memoryManager.runReview(
        [...this.history],
        this.reviewCountSinceDistill,
        "AUTO"
      );
    }
  }
}

// ==========================================
// 8. 事件与定时清理
// ==========================================
const typingStates = new Map<string, Map<string, number>>();

function isSomeoneTyping(cid: string): boolean {
  const now = Date.now() / 1000;
  const m = typingStates.get(cid);
  if (!m) return false;
  return [...m.values()].some((t) => now - t < 6);
}

function dateToSnowflake(date: Date): string {
  const DISCORD_EPOCH = 1_420_070_400_000n;
  return String(((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n) | 0n);
}

function isZh(locale: string | null | undefined): boolean {
  return (locale ?? "").startsWith("zh");
}

function loc(locale: string | null | undefined, en: string, zh: string): string {
  return isZh(locale) ? zh : en;
}

function keywordList(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") return [val];
  return [];
}

async function collectChannelHistory(
  channel: TextBasedChannel,
  limit: number,
  beforeTime?: Date
): Promise<Message[]> {
  const out: Message[] = [];
  if (!("messages" in channel)) return out;
  let before: string | undefined = beforeTime
    ? dateToSnowflake(beforeTime)
    : undefined;
  while (out.length < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, limit - out.length),
      before,
    });
    if (!batch.size) break;
    let oldest: Message | null = null;
    for (const m of batch.values()) {
      if (!oldest || m.createdTimestamp < oldest.createdTimestamp)
        oldest = m;
      out.push(m);
    }
    before = oldest?.id;
    if (batch.size < Math.min(100, limit - out.length)) break;
  }
  out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return out.slice(0, limit);
}

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
        .setDescription("The model name / 模型名称 (e.g. gpt-4o-mini)")
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

async function handleSlash(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const locale = interaction.locale;
  const member = interaction.member as GuildMember | null;
  const user = interaction.user;
  const channel = interaction.channel;
  const channelId = interaction.channelId;
  if (!channel?.isTextBased()) {
    await interaction.reply({ content: "❌ 无效频道", ephemeral: true });
    return;
  }

  try {
    switch (interaction.commandName) {
      case "shut_up": {
        await interaction.deferReply({ ephemeral: false });
        const mgr = ChannelManager.instances.get(channelId);
        if (mgr) {
          mgr.shutUpUntil = Date.now() / 1000 + 300;
          mgr.waitCond = null;
          if (mgr.timerTask) clearTimeout(mgr.timerTask);
          mgr.timerTask = null;
          await interaction.editReply(
            loc(
              locale,
              "🤐 Received. I will remain absolutely silent for the next 5 minutes.",
              "🤐 收到。我将在接下来的 5 分钟内保持绝对沉默。"
            )
          );
        } else {
          await interaction.editReply(
            loc(
              locale,
              "⚠️ The current channel is not actively monitored, no need to mute.",
              "⚠️ 当前频道并未激活监听，无需静音。"
            )
          );
        }
        break;
      }
      case "forget_me": {
        await interaction.deferReply({ ephemeral: true });
        const userPath = path.join(USER_MEMORY_DIR, `${user.id}.md`);
        if (existsSync(userPath)) {
          await unlink(userPath);
          await interaction.editReply(
            loc(
              locale,
              "🗑️ Your global profile has been completely destroyed.",
              "🗑️ 你的全局个人档案已被彻底销毁。"
            )
          );
        } else {
          await interaction.editReply(
            loc(
              locale,
              "📝 The AI has not yet established a global profile for you.",
              "📝 AI 目前还没有建立你的跨服个人档案。"
            )
          );
        }
        break;
      }
      case "clear": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const channelPath = path.join(CHANNEL_MEMORY_DIR, `${channelId}.md`);
        if (existsSync(channelPath)) await unlink(channelPath);
        const mgr = ChannelManager.instances.get(channelId);
        if (mgr) {
          mgr.history.length = 0;
          mgr.msgCount = 0;
          mgr.msgCountSinceReview = 0;
        }
        await interaction.editReply(
          loc(
            locale,
            "🧹 Format complete! Channel memory and context have been cleared.",
            "🧹 格式化完毕！当前频道的记忆和上下文已全部清空。"
          )
        );
        break;
      }
      case "memorize": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: false });
        const mgr = ChannelManager.instances.get(channelId);
        if (!mgr || !mgr.history.length) {
          await interaction.editReply(
            loc(
              locale,
              "⚠️ Channel not activated or no chat history.",
              "⚠️ 频道未激活或暂无对话记录。"
            )
          );
          return;
        }
        mgr.reviewCountSinceDistill += 1;
        const ok = await mgr.memoryManager.runReview(
          [...mgr.history],
          mgr.reviewCountSinceDistill,
          "MANUAL"
        );
        if (ok) {
          mgr.msgCountSinceReview = 0;
          await interaction.editReply(
            loc(locale, "✅ **Memory successfully packed!**", "✅ **记忆已打包！**")
          );
        } else {
          await interaction.editReply(
            loc(
              locale,
              "❌ Memory packing failed, check background logs.",
              "❌ 记忆打包失败，请查看后台日志。"
            )
          );
        }
        break;
      }
      case "distill": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: false });
        const mgr = ChannelManager.instances.get(channelId);
        if (!mgr) {
          await interaction.editReply(
            loc(locale, "⚠️ Channel not activated.", "⚠️ 频道未激活。")
          );
          return;
        }
        const eventText = (await mgr.memoryManager.getHistoryEventsText()).trim();
        if (!eventText) {
          await interaction.editReply(
            loc(
              locale,
              "⚠️ Channel historical events are empty.",
              "⚠️ 频道历史事件为空。"
            )
          );
          return;
        }
        await interaction.editReply(
          loc(
            locale,
            "⏳ **Engine started:** Scanning all historical events in background...",
            "⏳ **引擎启动：** 正在后台扫描所有历史事件..."
          )
        );
        void mgr.memoryManager.runDistill(eventText);
        break;
      }
      case "activate": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        ChannelManager.get(channelId);
        await setChannelConfig(channelId, { activated: true });
        await interaction.editReply(
          loc(
            locale,
            "🚀 OpenClaw activated in this channel.",
            "🚀 OpenClaw 已在此频道激活。"
          )
        );
        break;
      }
      case "deactivate": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        ChannelManager.instances.delete(channelId);
        await setChannelConfig(channelId, { activated: false });
        await interaction.editReply(
          loc(
            locale,
            "🛑 OpenClaw has stopped listening.",
            "🛑 OpenClaw 已停止监听。"
          )
        );
        break;
      }
      case "config": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const key = interaction.options.getString("key");
        const value = interaction.options.getString("value");
        const cfg = getChannelConfig(channelId);
        if (!key) {
          const head = loc(locale, "**Channel Config:**\n", "**频道配置：**\n");
          const body = Object.entries(cfg)
            .filter(([k]) => k !== "authorized_users")
            .map(([k, v]) => `\`${k}\` = \`${String(v)}\``)
            .join("\n");
          await interaction.editReply({ content: head + body });
          return;
        }
        if (!(key in DEFAULT_CHANNEL_CONFIG)) {
          await interaction.editReply(
            loc(
              locale,
              `❌ Unknown config key: \`${key}\``,
              `❌ 未知的频道配置: \`${key}\``
            )
          );
          return;
        }
        if (!value) {
          await interaction.editReply({
            content: `\`${key}\` = \`${String(cfg[key as keyof typeof cfg])}\``,
          });
          return;
        }
        const orig =
          DEFAULT_CHANNEL_CONFIG[key as keyof typeof DEFAULT_CHANNEL_CONFIG];
        let typed: unknown;
        try {
          if (typeof orig === "boolean") {
            typed = ["true", "1", "yes"].includes(value.toLowerCase());
          } else if (typeof orig === "number") {
            typed = Number(value);
            if (Number.isNaN(typed)) throw new Error("nan");
          } else {
            typed = value;
          }
        } catch {
          await interaction.editReply(
            loc(locale, "❌ Type error", "❌ 类型错误")
          );
          return;
        }
        await setChannelConfig(channelId, { [key]: typed });
        await interaction.editReply(
          loc(
            locale,
            `✅ Updated channel config \`${key}\` = \`${String(typed)}\``,
            `✅ 更新频道 \`${key}\` = \`${String(typed)}\``
          )
        );
        break;
      }
      case "set_api": {
        if (!interaction.guild) {
          await interaction.reply({
            content: loc(
              locale,
              "❌ This command is only available in servers. DMs automatically use your server's config.",
              "❌ 此命令仅限服务器内使用，私聊将自动读取您所在服务器的配置。"
            ),
            ephemeral: true,
          });
          return;
        }
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const model = interaction.options.getString("model", true);
        const apiKey = interaction.options.getString("api_key");
        const baseUrl = interaction.options.getString("base_url");
        const updates: Record<string, unknown> = { model };
        if (apiKey) updates.api_key = apiKey;
        if (baseUrl) updates.base_url = baseUrl;
        await setGuildConfig(interaction.guild.id, updates);
        const mask =
          apiKey && apiKey.length > 4
            ? `sk-***${apiKey.slice(-4)}`
            : apiKey
              ? "***"
              : loc(locale, "Unchanged", "未修改");
        await interaction.editReply(
          loc(
            locale,
            `✅ **Server Config Updated!**\n🤖 Model: \`${model}\`\n🔑 Key: \`${mask}\`\n🔗 URL: \`${baseUrl ?? "Default/Unchanged"}\``,
            `✅ **服务器级配置成功！**\n🤖 模型: \`${model}\`\n🔑 Key: \`${mask}\`\n🔗 接口: \`${baseUrl ?? "使用默认/未修改"}\``
          )
        );
        break;
      }
      case "whois": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const keyword = interaction.options.getString("keyword", true);
        const results = UserIndex.search(keyword);
        let msg: string;
        if (results.length) {
          msg =
            loc(locale, "🔍 Search Results:\n", "🔍 查询结果：\n") +
            results
              .slice(0, 20)
              .map(([u, n]) => `\`${u}\` → **${n}**`)
              .join("\n");
        } else {
          msg = loc(locale, "❌ Not found.", "❌ 未找到。");
        }
        await interaction.editReply({ content: msg });
        break;
      }
      case "retrieve_history": {
        if (!isAuthorized(member, user, channelId)) {
          await interaction.reply({
            content: loc(locale, "❌ Permission denied", "❌ 权限不足"),
            ephemeral: true,
          });
          return;
        }
        await interaction.deferReply();
        const limit = interaction.options.getInteger("limit", true);
        const startStr = interaction.options.getString("start_time");
        let beforeTime: Date | undefined;
        if (startStr) {
          const m = startStr.match(
            /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/
          );
          if (!m) {
            await interaction.editReply(
              loc(
                locale,
                "❌ Format: 2023-12-01 15:30",
                "❌ 格式: 2023-12-01 15:30"
              )
            );
            return;
          }
          const [, y, mo, d, h, mi] = m;
          beforeTime = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+08:00`);
        }
        const mgr = ChannelManager.get(channelId);
        if (!channel.isTextBased()) {
          await interaction.editReply(
            loc(locale, "❌ No read permission.", "❌ 无读取权限。")
          );
          return;
        }
        let msgs: Message[];
        try {
          msgs = await collectChannelHistory(channel, limit, beforeTime);
        } catch {
          await interaction.editReply(
            loc(locale, "❌ No read permission.", "❌ 无读取权限。")
          );
          return;
        }
        msgs = msgs.filter((m) => !m.author.bot || m.author.id === getBotId());
        if (!msgs.length) {
          await interaction.editReply(
            loc(locale, "❌ No messages retrieved.", "❌ 未抓取到任何消息。")
          );
          return;
        }
        const batches = Math.ceil(msgs.length / 100);
        await interaction.editReply(
          loc(
            locale,
            `⏳ Retrieved ${msgs.length} msgs, extracting in ${batches} batches...`,
            `⏳ 已抓取 ${msgs.length} 条，分 ${batches} 批提取...`
          )
        );
        let success = 0;
        for (let i = 0; i < msgs.length; i += 100) {
          const slice = msgs.slice(i, i + 100);
          const fmt: string[] = [];
          let lastId = "0";
          let lastTs = 0;
          for (const m of slice) {
            const nick =
              m.author.id === getBotId()
                ? "[OpenClaw]"
                : await UserIndex.getOrCreateNickname(m);
            const { lines, authorId, ts } = await formatMessage(
              m,
              nick,
              lastId,
              lastTs
            );
            lastId = authorId;
            lastTs = ts;
            fmt.push(...lines);
          }
          const ok = await mgr.memoryManager.runReview(
            fmt,
            0,
            `RETRIEVE-B${i / 100 + 1}`
          );
          if (ok) success += 1;
          await new Promise((r) => setTimeout(r, 2000));
        }
        await interaction.editReply(
          success
            ? loc(
                locale,
                `✅ Trace complete! Success ${success}/${batches} batches.`,
                `✅ 追溯完毕！成功 ${success}/${batches} 批。`
              )
            : loc(
                locale,
                "❌ Extraction entirely failed.",
                "❌ 提取全部失败。"
              )
        );
        break;
      }
      default:
        break;
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const msg = loc(
      interaction.locale,
      `❌ Internal Error: \`${err}\``,
      `❌ 内部错误: \`${err}\``
    );
    if (interaction.deferred || interaction.replied)
      await interaction.editReply({ content: msg }).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
}

// ==========================================
// 10. 事件与入口
// ==========================================

client.once(Events.ClientReady, async (c) => {
  await ensureDirs();
  await initConfig();
  await UserIndex.init();

  const chans = configCache.channels ?? {};
  for (const strCid of Object.keys(chans)) {
    const conf = chans[strCid];
    if (conf?.activated) ChannelManager.get(strCid);
  }

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

  console.log(`✅ OpenClaw 已登录 (ID: ${getBotId()})`);

  setInterval(() => {
    const now = Date.now() / 1000;
    for (const [cid, m] of typingStates) {
      for (const [uid, t] of m) {
        if (now - t >= 30) m.delete(uid);
      }
      if (!m.size) typingStates.delete(cid);
    }
  }, 60_000);
});

client.on(Events.TypingStart, (t) => {
  if (t.user?.bot) return;
  const uid = t.user?.id;
  const ch = t.channel;
  if (!uid || !ch) return;
  const inner = typingStates.get(ch.id) ?? new Map<string, number>();
  inner.set(uid, Date.now() / 1000);
  typingStates.set(ch.id, inner);
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const cid = msg.channel.id;
  const isDm = msg.channel.type === ChannelType.DM;
  const isMentioned = client.user ? msg.mentions.has(client.user.id) : false;

  const cfg = getChannelConfig(cid);
  const isActive = cfg.activated === true;

  if (!isActive && !isDm && !isMentioned) return;

  const mgr = isActive
    ? ChannelManager.get(cid)
    : new ChannelManager(cid);
  if (!(await mgr.parseMsg(msg))) return;
  if (isActive) mgr.maybeTriggerReview();
  if (mgr.isProcessing) return;

  const now = Date.now() / 1000;
  if (now < mgr.shutUpUntil) return;

  if (isMentioned || isDm) {
    await mgr.executeReply(msg.channel as TextBasedChannel, {
      stance: "react",
      angle: "直接回应",
    });
    return;
  }

  if (!isActive) return;

  if (mgr.timerTask) {
    clearTimeout(mgr.timerTask);
    mgr.timerTask = null;
  }

  if (!mgr.waitCond) {
    const jdg = (await mgr.callAi("judge")) as Record<string, unknown> | null;
    if (jdg) {
      const focus = jdg.focus as Record<string, unknown> | undefined;
      mgr.focus = (focus?.topic as string) ?? "无";
      const trig = (jdg.trigger as Record<string, unknown>) ?? {};
      mgr.waitCond = {
        ...trig,
        intent: (jdg.intent as Record<string, unknown>) ?? {
          stance: "pass",
        },
        recall_user_id: jdg.recall_user_id,
        expiry: now + Number(trig.expires_after ?? 120),
      };
      mgr.msgCount = 0;
    }
  }

  if (mgr.waitCond) {
    const cnd = mgr.waitCond;
    if (now > Number(cnd.expiry ?? 0)) {
      mgr.waitCond = null;
    } else {
      const typ = String(cnd.condition_type ?? "");
      const uid =
        cnd.recall_user_id === null || cnd.recall_user_id === undefined
          ? null
          : String(cnd.recall_user_id);
      const intent = cnd.intent as Record<string, unknown>;
      const noTyping = !isSomeoneTyping(cid);

      if (cnd.fire_now === true && noTyping) {
        await mgr.executeReply(
          msg.channel as TextBasedChannel,
          intent,
          uid
        );
      } else if (typ === "silence" && noTyping) {
        const sec = Number(cnd.condition_value ?? 15);
        mgr.timerTask = setTimeout(() => {
          mgr.timerTask = null;
          void (async () => {
            const t = Date.now() / 1000;
            if (
              !mgr.isProcessing &&
              t >= mgr.shutUpUntil &&
              msg.channel.isTextBased()
            ) {
              await mgr.executeReply(
                msg.channel as TextBasedChannel,
                intent,
                uid
              );
            }
          })();
        }, sec * 1000);
      } else if (
        typ === "gap" &&
        mgr.msgCount >= Number(cnd.condition_value ?? 5)
      ) {
        await mgr.executeReply(
          msg.channel as TextBasedChannel,
          intent,
          uid
        );
      } else if (typ === "keyword") {
        const kws = keywordList(cnd.condition_value);
        if (kws.some((k) => msg.content.includes(k))) {
          await mgr.executeReply(
            msg.channel as TextBasedChannel,
            intent,
            uid
          );
        }
      }
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlash(interaction);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const msg = loc(
      interaction.locale,
      `❌ Internal Error: \`${err}\``,
      `❌ 内部错误: \`${err}\``
    );
    if (interaction.deferred || interaction.replied)
      await interaction.editReply({ content: msg }).catch(() => {});
    else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
  }
});

await client.login(TOKEN);
