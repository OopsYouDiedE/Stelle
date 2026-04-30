import { z } from "zod";

/**
 * 核心元数据 Schema
 */
export const EventMetadataSchema = z.object({
  id: z.string().describe("唯一事件 ID"),
  timestamp: z.number().describe("时间戳"),
  source: z.string().describe("生产者"),
  reason: z.string().nullish().describe("原因上下文"), // 使用 nullish 增强兼容性
});

/**
 * 1. 调度类事件 (Tick Events)
 */
export const TickEventSchema = z.union([
  EventMetadataSchema.extend({ type: z.literal("inner.tick"), reason: z.string() }),
  EventMetadataSchema.extend({ type: z.literal("live.tick"), reason: z.string() }),
  EventMetadataSchema.extend({ type: z.literal("core.tick"), reason: z.string() }),
  EventMetadataSchema.extend({ type: z.literal("presence.tick"), reason: z.string() }),
]);

/**
 * 2. 认知反思类事件 (Reflection Events)
 */
export const ReflectionEventSchema = EventMetadataSchema.extend({
  type: z.literal("cursor.reflection"),
  source: z.enum(["discord", "discord_text_channel", "live", "live_danmaku", "browser", "desktop_input", "android_device", "system"]),
  payload: z.object({
    intent: z.string(),
    summary: z.string(),
    impactScore: z.number().min(0).max(10),
    salience: z.enum(["low", "medium", "high"]),
    emotion: z.string().optional(),
  }),
});

/**
 * 核心子对象 Schema (针对 Discord)
 */
export const DiscordUserSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable().optional(),
  bot: z.boolean().optional(),
  trustLevel: z.enum(["owner", "bot", "external"]).optional(),
});

export const DiscordMessageSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  guildId: z.string().nullable().optional(),
  author: DiscordUserSummarySchema,
  content: z.string(),
  cleanContent: z.string().optional(),
  createdTimestamp: z.number(),
  isMentioned: z.boolean().optional(),
  isDirectMessage: z.boolean().optional(),
  mentionedUserIds: z.array(z.string()).optional(),
});

/**
 * 3. 外部原始事件 (External Raw Events)
 */
const DiscordMessageBaseSchema = EventMetadataSchema.extend({
  source: z.literal("discord"),
  payload: z.object({
    message: DiscordMessageSummarySchema,
  }),
});

export const DiscordMessageEventSchema = z.union([
  DiscordMessageBaseSchema.extend({ type: z.literal("discord.message.received") }),
  DiscordMessageBaseSchema.extend({ type: z.literal("discord.text.message.received") }),
]);

const LiveEventReceivedBaseSchema = EventMetadataSchema.extend({
  source: z.string(),
  payload: z.record(z.any()).describe("原始直播事件载荷"),
});

export const LiveEventReceivedSchema = z.union([
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.received") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.danmaku.received") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.danmaku") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.gift") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.super_chat") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.guard") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.follow") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.like") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.entrance") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.system") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.event.unknown") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.ingress.dropped") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.batch.flushed") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.platform.status_changed") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.platform.error") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.tts.status") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.tts.error") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.moderation.decision") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.health.updated") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.control.command") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("live.program.updated") }),
  LiveEventReceivedBaseSchema.extend({ type: z.literal("scene.observation.received") }),
]);

export const BrowserObservationReceivedSchema = EventMetadataSchema.extend({
  type: z.literal("browser.observation.received"),
  source: z.enum(["browser", "system"]),
  payload: z.record(z.any()).describe("浏览器观察快照"),
});

export const DesktopInputObservationReceivedSchema = EventMetadataSchema.extend({
  type: z.literal("desktop.input.observation.received"),
  source: z.enum(["desktop_input", "system"]),
  payload: z.record(z.any()).describe("键鼠输入观察快照"),
});

/**
 * 4. 指令下发类事件 (Directive Events)
 */
export const LiveTopicRequestEventSchema = EventMetadataSchema.extend({
  type: z.literal("live.topic_request"),
  source: z.enum(["discord", "debug", "system"]),
  payload: z.object({
    text: z.string(),
    originMessageId: z.string().optional(),
    channelId: z.string().optional(),
    authorId: z.string().optional(),
    forceTopic: z.boolean().default(false),
  }),
});

export const LiveDirectSayEventSchema = EventMetadataSchema.extend({
  type: z.literal("live.direct_say"),
  source: z.enum(["debug", "system"]),
  payload: z.object({
    text: z.string(),
    originMessageId: z.string().optional(),
    channelId: z.string().optional(),
    authorId: z.string().optional(),
    forceTopic: z.boolean().default(false),
  }),
});

export const LiveRequestEventSchema = EventMetadataSchema.extend({
  type: z.literal("live.request"),
  source: z.enum(["discord", "debug", "system"]),
  payload: z.object({
    text: z.string(),
    originMessageId: z.string().optional(),
    channelId: z.string().optional(),
    authorId: z.string().optional(),
    forceTopic: z.boolean().default(false),
  }),
});

const OutputLaneSchema = z.enum(["emergency", "direct_response", "topic_hosting", "live_chat", "ambient", "inner_reaction", "debug"]);
const OutputIntentSchema = z.object({
  id: z.string(),
  cursorId: z.string(),
  sourceEventId: z.string().optional(),
  groupId: z.string().optional(),
  sequence: z.number().optional(),
  lane: OutputLaneSchema,
  priority: z.number(),
  salience: z.enum(["low", "medium", "high", "critical"]),
  text: z.string(),
  summary: z.string().optional(),
  topic: z.string().optional(),
  mergeKey: z.string().optional(),
  ttlMs: z.number().int(),
  interrupt: z.enum(["none", "soft", "hard"]),
  estimatedDurationMs: z.number().optional(),
  output: z.object({
    caption: z.boolean().optional(),
    tts: z.boolean().optional(),
    motion: z.string().optional(),
    expression: z.string().optional(),
    discordReply: z.object({
      channelId: z.string(),
      messageId: z.string().optional(),
    }).optional(),
  }),
  metadata: z.record(z.any()).optional(),
});

const StageOutputEventBaseSchema = EventMetadataSchema.extend({
  source: z.string(),
  payload: z.object({
    intent: OutputIntentSchema,
    reason: z.string().optional(),
  }),
});

export const StageOutputEventSchema = z.union([
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.received") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.accepted") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.queued") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.dropped") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.started") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.completed") }),
  StageOutputEventBaseSchema.extend({ type: z.literal("stage.output.interrupted") }),
]);

export const StagePolicyOverlayEventSchema = EventMetadataSchema.extend({
  type: z.literal("stage.policy.overlay"),
  source: z.string(),
  payload: z.record(z.any()),
});

import { DeviceActionIntentSchema } from "../device/action_types.js";

const DeviceActionEventBaseSchema = EventMetadataSchema.extend({
  source: z.string(),
  payload: z.object({
    intent: DeviceActionIntentSchema,
    reason: z.string().optional(),
    result: z.record(z.any()).optional(),
    error: z.string().optional(),
  }),
});

export const DeviceActionEventSchema = z.union([
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.proposed") }),
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.accepted") }),
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.rejected") }),
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.started") }),
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.completed") }),
  DeviceActionEventBaseSchema.extend({ type: z.literal("device.action.failed") }),
]);

/**
 * 4. 指令下发类事件 (Directive Events)
 */
export const BehaviorPolicySchema = z.object({
  replyBias: z.enum(["aggressive", "normal", "selective", "silent"]).optional(),
  vibeIntensity: z.number().min(1).max(5).optional(),
  focusTopic: z.string().optional(),
  forbiddenTopics: z.array(z.string()).optional(),
  instruction: z.string().optional(), // 保留自然语言作为补充
});

export const DirectiveEventSchema = EventMetadataSchema.extend({
  type: z.literal("cursor.directive"),
  source: z.enum(["inner", "system"]),
  payload: z.object({
    target: z.enum(["discord", "discord_text_channel", "live", "live_danmaku", "browser", "desktop_input", "android_device", "global"]),
    action: z.string(),
    policy: BehaviorPolicySchema.optional(), // 结构化策略
    parameters: z.record(z.any()).optional(),
    priority: z.number().default(1),
    expiresAt: z.number().optional(),
  }),
});

/**
 * 5. 系统通知类事件
 */
const SystemEventBaseSchema = EventMetadataSchema.extend({
  payload: z.record(z.any()).optional(),
});

export const SystemEventSchema = z.union([
  SystemEventBaseSchema.extend({ type: z.literal("system.ready") }),
  SystemEventBaseSchema.extend({ type: z.literal("system.error") }),
  SystemEventBaseSchema.extend({ type: z.literal("system.shutdown") }),
]);

/**
 * 统一事件联合类型
 */
export const StelleEventSchema = z.union([
  TickEventSchema,
  ReflectionEventSchema,
  DiscordMessageEventSchema,
  LiveEventReceivedSchema, // 新增
  BrowserObservationReceivedSchema,
  DesktopInputObservationReceivedSchema,
  LiveTopicRequestEventSchema,
  LiveDirectSayEventSchema,
  LiveRequestEventSchema,
  StageOutputEventSchema,
  StagePolicyOverlayEventSchema,
  DeviceActionEventSchema,
  DirectiveEventSchema,
  SystemEventSchema,
]);

export type StelleEvent = z.infer<typeof StelleEventSchema>;
export type StelleEventType = StelleEvent["type"];
