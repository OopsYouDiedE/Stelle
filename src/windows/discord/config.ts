import { asRecord, clamp } from "../../shared/json.js";
import { bool } from "../../core/config/index.js";

export interface DiscordConfig {
  enabled: boolean;
  token?: string;
  ambientEnabled: boolean;
  maxReplyChars: number;
  cooldownSeconds: number;
}

export function loadDiscordConfig(rawYaml: Record<string, unknown> = {}): DiscordConfig {
  const cursors = asRecord(rawYaml.cursors);
  const discordCursor = Object.assign({}, asRecord(cursors.discord), asRecord(cursors.discord_text_channel));

  return {
    enabled: discordCursor.enabled !== false,
    token: process.env.DISCORD_TOKEN,
    ambientEnabled: discordCursor.ambientEnabled !== false,
    maxReplyChars: clamp(Number(discordCursor.maxReplyChars || 900), 100, 4000, 900),
    cooldownSeconds: clamp(Number(discordCursor.cooldownSeconds || 240), 0, 3600, 240),
  };
}
