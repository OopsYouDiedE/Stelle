import { asRecord, asString, clamp } from "../../shared/json.js";
import { bool, mergeRecords } from "../../core/config/index.js";
import { loadLiveThanksConfig, loadLiveIdleConfig, loadLiveScheduleConfig, type LiveThanksConfig, type LiveIdleConfig, type LiveScheduleConfig } from "../../shared/live_config_schemas.js";

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



export function loadLiveConfig(rawYaml: Record<string, unknown> = {}): LiveConfig {
  const cursors = asRecord(rawYaml.cursors);
  const liveCursor = mergeRecords(asRecord(cursors.live), asRecord(cursors.live_danmaku));
  const liveRoot = mergeRecords(asRecord(rawYaml.live), liveCursor);

  return {
    enabled: liveCursor.enabled !== false,
    rendererHost: asString(process.env.LIVE_RENDERER_HOST) ?? "127.0.0.1",
    rendererPort: clamp(process.env.LIVE_RENDERER_PORT ?? liveCursor.rendererPort, 1, 65535, 8787),
    ttsEnabled:
      (liveCursor.ttsEnabled ?? process.env.LIVE_TTS_ENABLED) !== false && process.env.LIVE_TTS_ENABLED !== "false",
    obsControlEnabled: liveCursor.obsControlEnabled === true || process.env.OBS_CONTROL_ENABLED === "true",
    speechQueueLimit: clamp(process.env.LIVE_SPEECH_QUEUE_LIMIT ?? liveCursor.speechQueueLimit, 1, 12, 3),
    platforms: loadLivePlatformsConfig(liveRoot),
    thanks: loadLiveThanksConfig(liveRoot),
    idle: loadLiveIdleConfig(liveRoot),
    schedule: loadLiveScheduleConfig(liveRoot),
  };
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

function parseTikTokProvider(value: string | undefined): "websocket" | "tiktok-live-connector" | undefined {
  if (value === "websocket" || value === "tiktok-live-connector") return value;
  return undefined;
}


