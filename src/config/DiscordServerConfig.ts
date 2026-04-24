import fs from "node:fs";
import YAML from "yaml";

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

function uniqueAlias(base: string, usedAliases: Set<string>): string {
  const trimmed = base.trim() || "成员";
  if (!usedAliases.has(trimmed)) return trimmed;
  for (let index = 2; index < 1000; index += 1) {
    const next = `${trimmed}${index}`;
    if (!usedAliases.has(next)) return next;
  }
  return `${trimmed}${Date.now()}`;
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
