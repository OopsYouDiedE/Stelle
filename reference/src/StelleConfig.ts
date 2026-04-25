import fs from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import YAML from "yaml";

export const PRIMARY_GEMINI_MODEL = "gemma-4-31b-it";
export const SECONDARY_GEMINI_MODEL = "gemma-4-31b-it";
export const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export interface StelleModelConfig {
  apiKey: string;
  baseUrl?: string;
  primaryModel: string;
  secondaryModel: string;
  ttsModel: string;
}

export interface StelleRuntimeConfig {
  channels?: Record<string, { activated?: boolean }>;
}

export interface DiscordChannelAccessConfig {
  activated?: boolean;
}

export interface DiscordGuildNicknameRecord {
  alias: string;
  sourceName?: string;
  updatedAt?: string;
}

export interface DiscordGuildConfig {
  managers?: string[];
  nicknames?: Record<string, DiscordGuildNicknameRecord>;
}

export interface DiscordServerConfigFile {
  channels?: Record<string, DiscordChannelAccessConfig>;
  guilds?: Record<string, DiscordGuildConfig>;
}

const SECRET_KEY_PATTERN = /(?:secret|token|api[_-]?key|password|cookie)/i;

function firstDefined(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? "";
}

export function loadRawConfig(path = "config.yaml"): StelleRuntimeConfig {
  if (!fs.existsSync(path)) return {};
  return YAML.parse(fs.readFileSync(path, "utf8")) as StelleRuntimeConfig;
}

export function loadStelleModelConfig(): StelleModelConfig {
  const apiKey = firstDefined(process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY, process.env.AISTUDIO_API_KEY);
  return {
    apiKey,
    baseUrl: normalizeGeminiBaseUrl(firstDefined(process.env.GEMINI_BASE_URL, process.env.AISTUDIO_BASE_URL)),
    primaryModel: process.env.STELLE_PRIMARY_MODEL || PRIMARY_GEMINI_MODEL,
    secondaryModel: process.env.STELLE_SECONDARY_MODEL || SECONDARY_GEMINI_MODEL,
    ttsModel: process.env.STELLE_TTS_MODEL || GEMINI_TTS_MODEL,
  };
}

export function normalizeGeminiBaseUrl(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const url = new URL(baseUrl);
    if (url.hostname.includes("generativelanguage.googleapis.com")) {
      return `${url.protocol}//${url.hostname}`;
    }
    return baseUrl.replace(/\/+$/, "");
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}

function uniqueAlias(base: string, usedAliases: Set<string>): string {
  const trimmed = base.trim() || "成员";
  if (!usedAliases.has(trimmed)) return trimmed;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${trimmed}${index}`;
    if (!usedAliases.has(next)) return next;
  }
  return `${trimmed}${Date.now()}`;
}

function sanitizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfig(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : sanitizeConfig(child);
    }
    return output;
  }
  return value;
}

export class AsyncConfigStore<T extends object> {
  private pending: Promise<void> = Promise.resolve();
  private latest: T | null = null;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    private readonly allowedRoot: string = process.cwd()
  ) {}

  get isDirty(): boolean {
    return this.dirty;
  }

  save(config: T): Promise<void> {
    this.latest = config;
    this.dirty = true;
    this.pending = this.pending.then(() => this.flushLatest());
    return this.pending;
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private async flushLatest(): Promise<void> {
    if (!this.latest) return;
    const target = resolve(this.filePath);
    const root = resolve(this.allowedRoot);
    const rel = relative(root, target);
    if (rel.startsWith("..") || rel === ".." || resolve(root, rel) !== target) {
      throw new Error(`Config path is outside allowed root: ${target}`);
    }

    const payload = JSON.stringify(sanitizeConfig(this.latest), null, 2);
    const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, target);
    this.dirty = false;
  }
}

export class DiscordServerConfigStore {
  private config: DiscordServerConfigFile | null = null;

  constructor(private readonly path = "config.yaml") {}

  load(): DiscordServerConfigFile {
    if (this.config) return this.config;
    if (!fs.existsSync(this.path)) {
      this.config = {};
      return this.config;
    }
    this.config = (YAML.parse(fs.readFileSync(this.path, "utf8")) as DiscordServerConfigFile) ?? {};
    return this.config;
  }

  snapshot(): DiscordServerConfigFile {
    const config = this.load();
    return JSON.parse(JSON.stringify(config)) as DiscordServerConfigFile;
  }

  isChannelActivated(channelId: string): boolean {
    return this.load().channels?.[channelId]?.activated === true;
  }

  setChannelActivated(channelId: string, activated: boolean): void {
    const config = this.ensureConfig();
    config.channels ??= {};
    config.channels[channelId] = { ...(config.channels[channelId] ?? {}), activated };
    this.save();
  }

  listManagers(guildId: string): string[] {
    return [...(this.load().guilds?.[guildId]?.managers ?? [])];
  }

  isManager(guildId: string, userId: string): boolean {
    return this.load().guilds?.[guildId]?.managers?.includes(userId) ?? false;
  }

  addManager(guildId: string, userId: string): boolean {
    const guild = this.ensureGuild(guildId);
    guild.managers ??= [];
    if (guild.managers.includes(userId)) return false;
    guild.managers.push(userId);
    guild.managers.sort();
    this.save();
    return true;
  }

  removeManager(guildId: string, userId: string): boolean {
    const guild = this.ensureGuild(guildId);
    const next = (guild.managers ?? []).filter((id) => id !== userId);
    if ((guild.managers ?? []).length === next.length) return false;
    guild.managers = next;
    this.save();
    return true;
  }

  getAlias(guildId: string, userId: string): string | undefined {
    return this.load().guilds?.[guildId]?.nicknames?.[userId]?.alias;
  }

  ensureAlias(guildId: string, userId: string, sourceName: string): string {
    const guild = this.ensureGuild(guildId);
    guild.nicknames ??= {};

    const existing = guild.nicknames[userId];
    if (existing?.alias) {
      const sourceChanged = sourceName.trim() && existing.sourceName !== sourceName;
      if (sourceChanged) {
        guild.nicknames[userId] = {
          ...existing,
          sourceName,
          updatedAt: new Date().toISOString(),
        };
        this.save();
      }
      return existing.alias;
    }

    const usedAliases = new Set(
      Object.entries(guild.nicknames)
        .filter(([id]) => id !== userId)
        .map(([, record]) => record.alias)
        .filter(Boolean)
    );
    const alias = uniqueAlias(sourceName, usedAliases);
    guild.nicknames[userId] = {
      alias,
      sourceName,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return alias;
  }

  private ensureConfig(): DiscordServerConfigFile {
    const config = this.load();
    config.channels ??= {};
    config.guilds ??= {};
    return config;
  }

  private ensureGuild(guildId: string): DiscordGuildConfig {
    const config = this.ensureConfig();
    config.guilds ??= {};
    config.guilds[guildId] ??= {};
    return config.guilds[guildId]!;
  }

  private save(): void {
    if (!this.config) return;
    const text = YAML.stringify(this.config, {
      indent: 2,
      lineWidth: 0,
      sortMapEntries: false,
    });
    fs.writeFileSync(this.path, text, "utf8");
  }
}

export { sanitizeConfig };
