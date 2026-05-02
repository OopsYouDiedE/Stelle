import { asRecord, asString, clamp } from "./json.js";
import { bool, mergeRecords, stringList } from "../core/config/index.js";

export interface LiveThanksConfig {
  enabled: boolean;
  usernameMaxLen: number;
  cooldownSeconds: number;
  giftLowestAmount: number;
  entranceTemplates: string[];
  followTemplates: string[];
  giftTemplates: string[];
  guardTemplates: string[];
  superChatTemplates: string[];
}

export interface LiveIdleConfig {
  enabled: boolean;
  minQuietSeconds: number;
  cooldownSeconds: number;
  templates: string[];
}

export interface LiveScheduleItemConfig {
  id: string;
  enabled: boolean;
  intervalSeconds: number;
  templates: string[];
}

export interface LiveScheduleConfig {
  enabled: boolean;
  items: LiveScheduleItemConfig[];
}

export function loadLiveThanksConfig(liveRoot: Record<string, unknown>): LiveThanksConfig {
  const thanks = asRecord(liveRoot.thanks);
  return {
    enabled: bool(process.env.LIVE_THANKS_ENABLED, thanks.enabled !== false),
    usernameMaxLen: clamp(thanks.usernameMaxLen, 1, 40, 12),
    cooldownSeconds: clamp(thanks.cooldownSeconds, 0, 3600, 20),
    giftLowestAmount: clamp(thanks.giftLowestAmount, 0, 1_000_000, 0),
    entranceTemplates: stringList(thanks.entranceTemplates, ["欢迎{username}来到直播间"]),
    followTemplates: stringList(thanks.followTemplates, ["感谢{username}的关注"]),
    giftTemplates: stringList(thanks.giftTemplates, ["感谢{username}送的{gift_name}"]),
    guardTemplates: stringList(thanks.guardTemplates, ["感谢{username}开通的{gift_name}"]),
    superChatTemplates: stringList(thanks.superChatTemplates, ["感谢{username}的醒目留言：{comment}"]),
  };
}

export function loadLiveIdleConfig(liveRoot: Record<string, unknown>): LiveIdleConfig {
  const idle = asRecord(liveRoot.idle);
  return {
    enabled: bool(process.env.LIVE_IDLE_ENABLED, idle.enabled !== false),
    minQuietSeconds: clamp(process.env.LIVE_IDLE_MIN_QUIET_SECONDS ?? idle.minQuietSeconds, 5, 3600, 90),
    cooldownSeconds: clamp(process.env.LIVE_IDLE_COOLDOWN_SECONDS ?? idle.cooldownSeconds, 5, 7200, 120),
    templates: stringList(idle.templates, ["直播间安静下来了，那我来抛个小话题：你们今天有什么想聊的吗？"]),
  };
}

export function loadLiveScheduleConfig(liveRoot: Record<string, unknown>): LiveScheduleConfig {
  const schedule = asRecord(liveRoot.schedule);
  const rawItems = Array.isArray(schedule.items) ? schedule.items : [];
  const items = rawItems
    .map((item, index): LiveScheduleItemConfig => {
      const record = asRecord(item);
      return {
        id: asString(record.id) ?? `schedule-${index + 1}`,
        enabled: record.enabled !== false,
        intervalSeconds: clamp(record.intervalSeconds, 10, 24 * 3600, 600),
        templates: stringList(record.templates, []),
      };
    })
    .filter((item) => item.templates.length > 0);
  return {
    enabled: bool(process.env.LIVE_SCHEDULE_ENABLED, schedule.enabled === true),
    items,
  };
}
