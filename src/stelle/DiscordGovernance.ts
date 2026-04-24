import type { Message } from "discord.js";
import { PermissionsBitField } from "discord.js";
import type { DiscordServerConfigStore } from "../config/DiscordServerConfig.js";

export interface DiscordAdminCommand {
  type: "channel_allow" | "channel_deny" | "manager_add" | "manager_remove" | "show_config";
  targetUserId?: string;
}

function stripBotMention(text: string, botUserId?: string | null): string {
  if (!botUserId) return text.trim();
  return text.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}

export function parseDiscordAdminCommand(text: string, botUserId?: string | null): DiscordAdminCommand | null {
  const normalized = stripBotMention(text, botUserId);
  if (!normalized) return null;

  if (/^(允许|启用|开放)(本频道|这个频道|当前频道)$/.test(normalized)) {
    return { type: "channel_allow" };
  }
  if (/^(禁用|关闭|禁止)(本频道|这个频道|当前频道)$/.test(normalized)) {
    return { type: "channel_deny" };
  }
  if (/^(查看|显示)(本服配置|频道配置|bot配置|管理配置)$/.test(normalized)) {
    return { type: "show_config" };
  }

  const managerMatch = normalized.match(/^(添加|设为|指定|新增)(bot管理者|机器人管理者)\s+<@!?(\d+)>$/);
  if (managerMatch) {
    return { type: "manager_add", targetUserId: managerMatch[3] };
  }
  const removeManagerMatch = normalized.match(/^(移除|取消|删除)(bot管理者|机器人管理者)\s+<@!?(\d+)>$/);
  if (removeManagerMatch) {
    return { type: "manager_remove", targetUserId: removeManagerMatch[3] };
  }

  return null;
}

export function isDiscordAdmin(message: Message): boolean {
  if (!message.inGuild()) return false;
  return message.member?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
}

export function canManageDiscordBot(input: {
  ownerUserId?: string | null;
  config: DiscordServerConfigStore;
  message: Message;
}): boolean {
  const { ownerUserId, config, message } = input;
  if (ownerUserId && message.author.id === ownerUserId) return true;
  if (!message.guildId) return ownerUserId ? message.author.id === ownerUserId : false;
  if (isDiscordAdmin(message)) return true;
  return config.isManager(message.guildId, message.author.id);
}

export function canEditManagers(input: {
  ownerUserId?: string | null;
  config: DiscordServerConfigStore;
  message: Message;
}): boolean {
  const { ownerUserId, message } = input;
  if (ownerUserId && message.author.id === ownerUserId) return true;
  return isDiscordAdmin(message);
}
