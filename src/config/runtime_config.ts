/**
 * 模块：配置加载器
 */
// === Imports ===
import fs from "node:fs";
import YAML from "yaml";
import { asRecord, asString, clamp } from "../utils/json.js";

// === Types & Interfaces ===
export type LlmProviderType = "dashscope" | "gemini" | "openai" | "custom";

export interface ModelProviderConfig {
  provider: LlmProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ModelConfig {
  primary: ModelProviderConfig;
  secondary: ModelProviderConfig;
  fallback?: ModelProviderConfig;
  apiKey: string; // 后向兼容或全局 Key
}

export interface DiscordConfig {
  enabled: boolean;
  token?: string;
  ambientEnabled: boolean;
  ambientChannelIds: string[];
  maxReplyChars: number;
  cooldownSeconds: number;
}

export interface LiveConfig {
  enabled: boolean;
  rendererHost: string;
  rendererPort: number;
  ttsEnabled: boolean;
  obsControlEnabled: boolean;
  speechQueueLimit: number;
  platforms: LivePlatformsConfig;
  thanks: LiveThanksConfig;
  idle: LiveIdleConfig;
  schedule: LiveScheduleConfig;
}

export interface LivePlatformsConfig {
  bilibili: { enabled: boolean; roomId?: string };
  twitch: { enabled: boolean; channel?: string; username?: string; oauthToken?: string; trackJoins?: boolean };
  youtube: {
    enabled: boolean;
    liveChatId?: string;
    videoId?: string;
    apiKey?: string;
    oauthToken?: string;
    forwardHistory?: boolean;
  };
  tiktok: {
    enabled: boolean;
    username?: string;
    provider?: "websocket" | "tiktok-live-connector";
    webSocketUrl?: string;
    apiKey?: string;
  };
}

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

export interface CoreConfig {
  reflectionIntervalHours: number;
  reflectionAccumulationThreshold: number;
}

export interface DebugConfig {
  enabled: boolean;
  requireToken: boolean;
  token?: string;
  allowExternalWrite: boolean;
}

export interface ControlConfig {
  requireToken: boolean;
  token?: string;
}

export interface BrowserConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface DesktopInputConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface AndroidConfig {
  enabled: boolean;
  allowlist?: {
    cursors?: string[];
    resources?: string[];
    resourceKinds?: string[];
    risks?: string[];
  };
}

export interface SceneObservationConfig {
  enabled: boolean;
}

export interface RuntimeConfig {
  models: ModelConfig;
  discord: DiscordConfig;
  live: LiveConfig;
  browser: BrowserConfig;
  desktopInput: DesktopInputConfig;
  android: AndroidConfig;
  sceneObservation: SceneObservationConfig;
  core: CoreConfig;
  debug: DebugConfig;
  control: ControlConfig;
  rawYaml: Record<string, unknown>;
}

// === Config Loader ===
export function loadRuntimeConfig(): RuntimeConfig {
  const rawYaml = loadYamlConfig();
  const cursors = asRecord(rawYaml.cursors);

  // Cursor aliases. Canonical module ids override short aliases when both are present.
  const discordCursor = mergeRecords(asRecord(cursors.discord), asRecord(cursors.discord_text_channel));
  const legacyDiscordChannels = asRecord(rawYaml.channels);
  const liveCursor = mergeRecords(asRecord(cursors.live), asRecord(cursors.live_danmaku));
  const liveRoot = mergeRecords(asRecord(rawYaml.live), liveCursor);
  const browserCursor = asRecord(cursors.browser);
  const desktopInputCursor = asRecord(cursors.desktop_input || cursors.desktopInput);
  const androidCursor = asRecord(cursors.android || cursors.android_device || cursors.androidDevice);
  const sceneObservation = asRecord(rawYaml.sceneObservation || rawYaml.scene_observation);

  const core = asRecord(rawYaml.core);
  const debug = asRecord(rawYaml.debug);
  const control = asRecord(rawYaml.control);

  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
  const openaiApiKey = process.env.OPENAI_API_KEY || "";

  // Provider resolution logic
  const resolveProvider = (model: string): LlmProviderType => (model.startsWith("gemini") ? "gemini" : "dashscope");
  const resolveConfig = (model: string): ModelProviderConfig => {
    const provider = resolveProvider(model);
    return {
      provider,
      model,
      apiKey: provider === "gemini" ? geminiApiKey : dashscopeApiKey,
      baseUrl:
        provider === "dashscope"
          ? process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
          : undefined,
    };
  };

  const primaryModel = process.env.STELLE_PRIMARY_MODEL || "qwen-max";
  const secondaryModel = process.env.STELLE_SECONDARY_MODEL || "qwen-plus";
  const debugToken = process.env.STELLE_DEBUG_TOKEN || asString(debug.token) || undefined;

  return {
    models: {
      primary: resolveConfig(primaryModel),
      secondary: resolveConfig(secondaryModel),
      fallback: {
        provider: "dashscope",
        model: "qwen-plus",
        apiKey: dashscopeApiKey,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      },
      apiKey: dashscopeApiKey || geminiApiKey || openaiApiKey,
    },
    discord: {
      enabled: discordCursor.enabled !== false,
      token: process.env.DISCORD_TOKEN,
      ambientEnabled: discordCursor.ambientEnabled !== false,
      ambientChannelIds: loadDiscordAmbientChannelIds(legacyDiscordChannels),
      maxReplyChars: clamp(Number(discordCursor.maxReplyChars || 900), 100, 4000, 900),
      cooldownSeconds: clamp(Number(discordCursor.cooldownSeconds || 240), 0, 3600, 240),
    },
    live: {
      enabled: liveCursor.enabled !== false,
      rendererHost: asString(process.env.LIVE_RENDERER_HOST) ?? "127.0.0.1",
      rendererPort: clamp(process.env.LIVE_RENDERER_PORT ?? liveCursor.rendererPort, 1, 65535, 8787),
      ttsEnabled:
        (liveCursor.ttsEnabled ?? process.env.LIVE_TTS_ENABLED) !== false && process.env.LIVE_TTS_ENABLED !== "false",
      obsControlEnabled: liveCursor.obsControlEnabled === true || process.env.OBS_CONTROL_ENABLED === "true",
      speechQueueLimit: clamp(process.env.LIVE_SPEECH_QUEUE_LIMIT ?? liveCursor.speechQueueLimit, 1, 32, 12),
      platforms: loadLivePlatformsConfig(liveRoot),
      thanks: loadLiveThanksConfig(liveRoot),
      idle: loadLiveIdleConfig(liveRoot),
      schedule: loadLiveScheduleConfig(liveRoot),
    },
    browser: {
      enabled: browserCursor.enabled === true || process.env.BROWSER_ENABLED === "true",
      allowlist: asRecord(browserCursor.allowlist) as any,
    },
    desktopInput: {
      enabled: desktopInputCursor.enabled === true || process.env.DESKTOP_INPUT_ENABLED === "true",
      allowlist: asRecord(desktopInputCursor.allowlist) as any,
    },
    android: {
      enabled: androidCursor.enabled === true || process.env.ANDROID_DEVICE_ENABLED === "true",
      allowlist: asRecord(androidCursor.allowlist) as any,
    },
    sceneObservation: {
      enabled: sceneObservation.enabled === true || process.env.SCENE_OBSERVATION_ENABLED === "true",
    },
    core: {
      reflectionIntervalHours: clamp(core.reflectionIntervalHours, 1, 168, 6),
      reflectionAccumulationThreshold: clamp(core.reflectionAccumulationThreshold, 1, 10000, 30),
    },
    debug: {
      enabled: process.env.STELLE_DEBUG_ENABLED === "true" || debug.enabled === true,
      requireToken: process.env.STELLE_DEBUG_REQUIRE_TOKEN !== "false" && debug.requireToken !== false,
      token: debugToken,
      allowExternalWrite: process.env.STELLE_DEBUG_ALLOW_EXTERNAL_WRITE === "true" || debug.allowExternalWrite === true,
    },
    control: {
      requireToken: process.env.STELLE_CONTROL_REQUIRE_TOKEN !== "false" && control.requireToken !== false,
      token: process.env.STELLE_CONTROL_TOKEN || asString(control.token) || debugToken,
    },
    rawYaml,
  };
}

export function loadYamlConfig(filePath = "config.yaml"): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  return asRecord(YAML.parse(fs.readFileSync(filePath, "utf8")));
}

export function loadModelConfig(): ModelConfig {
  return loadRuntimeConfig().models;
}

// === Internal Helpers ===
function mergeRecords(...records: Record<string, unknown>[]): Record<string, unknown> {
  return Object.assign({}, ...records);
}

function loadLivePlatformsConfig(liveRoot: Record<string, unknown>): LivePlatformsConfig {
  const platforms = asRecord(liveRoot.platforms);
  const bilibili = asRecord(platforms.bilibili);
  const twitch = asRecord(platforms.twitch);
  const youtube = asRecord(platforms.youtube);
  const tiktok = asRecord(platforms.tiktok);
  return {
    bilibili: {
      enabled: bool(process.env.BILIBILI_LIVE_ENABLED, bilibili.enabled === true),
      roomId: asString(process.env.BILIBILI_ROOM_ID) ?? asString(bilibili.roomId),
    },
    twitch: {
      enabled: bool(process.env.TWITCH_LIVE_ENABLED, twitch.enabled === true),
      channel: asString(process.env.TWITCH_CHANNEL) ?? asString(twitch.channel),
      username: asString(process.env.TWITCH_BOT_USERNAME) ?? asString(twitch.username),
      oauthToken: asString(process.env.TWITCH_OAUTH_TOKEN) ?? asString(twitch.oauthToken),
      trackJoins: bool(process.env.TWITCH_TRACK_JOINS, twitch.trackJoins === true),
    },
    youtube: {
      enabled: bool(process.env.YOUTUBE_LIVE_ENABLED, youtube.enabled === true),
      liveChatId: asString(process.env.YOUTUBE_LIVE_CHAT_ID) ?? asString(youtube.liveChatId),
      videoId: asString(process.env.YOUTUBE_VIDEO_ID) ?? asString(youtube.videoId),
      apiKey: asString(process.env.YOUTUBE_API_KEY) ?? asString(youtube.apiKey),
      oauthToken: asString(process.env.YOUTUBE_OAUTH_TOKEN) ?? asString(youtube.oauthToken),
      forwardHistory: bool(process.env.YOUTUBE_FORWARD_HISTORY, youtube.forwardHistory === true),
    },
    tiktok: {
      enabled: bool(process.env.TIKTOK_LIVE_ENABLED, tiktok.enabled === true),
      username: asString(process.env.TIKTOK_USERNAME) ?? asString(tiktok.username),
      provider: parseTikTokProvider(asString(process.env.TIKTOK_PROVIDER) ?? asString(tiktok.provider)),
      webSocketUrl: asString(process.env.TIKTOK_LIVE_WS_URL) ?? asString(tiktok.webSocketUrl),
      apiKey: asString(process.env.TIKTOK_API_KEY) ?? asString(tiktok.apiKey),
    },
  };
}

function loadDiscordAmbientChannelIds(legacyChannels: Record<string, unknown>): string[] {
  const envIds = csvList(process.env.DISCORD_AMBIENT_CHANNEL_IDS);
  if (envIds.length > 0) return envIds;

  const legacyIds = Object.entries(legacyChannels)
    .filter(([, value]) => asRecord(value).activated === true)
    .map(([channelId]) => channelId);
  if (legacyIds.length > 0) {
    console.warn(
      "[Config] config.yaml channels is deprecated. Move ambient Discord channel ids to DISCORD_AMBIENT_CHANNEL_IDS.",
    );
  }
  return legacyIds;
}

function loadLiveThanksConfig(liveRoot: Record<string, unknown>): LiveThanksConfig {
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

function loadLiveIdleConfig(liveRoot: Record<string, unknown>): LiveIdleConfig {
  const idle = asRecord(liveRoot.idle);
  return {
    enabled: bool(process.env.LIVE_IDLE_ENABLED, idle.enabled !== false),
    minQuietSeconds: clamp(process.env.LIVE_IDLE_MIN_QUIET_SECONDS ?? idle.minQuietSeconds, 5, 3600, 90),
    cooldownSeconds: clamp(process.env.LIVE_IDLE_COOLDOWN_SECONDS ?? idle.cooldownSeconds, 5, 7200, 120),
    templates: stringList(idle.templates, ["直播间安静下来了，那我来抛个小话题：你们今天有什么想聊的吗？"]),
  };
}

function loadLiveScheduleConfig(liveRoot: Record<string, unknown>): LiveScheduleConfig {
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

// === Utility Functions ===
function stringList(value: unknown, fallback: string[]): string[] {
  const list = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
  return list.length ? list : fallback;
}

function csvList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function parseTikTokProvider(value: string | undefined): "websocket" | "tiktok-live-connector" | undefined {
  if (value === "websocket" || value === "tiktok-live-connector") return value;
  return undefined;
}
