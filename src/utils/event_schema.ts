import { z } from "zod";

/**
 * 核心元数据 Schema
 */
export const EventMetadataSchema = z.object({
  id: z.string().describe("唯一事件 ID"),
  timestamp: z.number().describe("时间戳"),
  source: z.string().describe("生产者"),
  reason: z.string().optional().describe("原因上下文"),
});

/**
 * 1. 调度类事件 (Tick Events)
 */
const TickTypes = z.enum(["inner.tick", "live.tick", "core.tick", "presence.tick"]);
export const TickEventSchema = EventMetadataSchema.extend({
  type: TickTypes,
  reason: z.string(),
});

/**
 * 2. 认知反思类事件 (Reflection Events)
 */
export const ReflectionEventSchema = EventMetadataSchema.extend({
  type: z.literal("cursor.reflection"),
  source: z.enum(["discord", "live", "system"]),
  payload: z.object({
    intent: z.string(),
    summary: z.string(),
    impactScore: z.number().min(0).max(10),
    salience: z.enum(["low", "medium", "high"]),
    emotion: z.string().optional(),
  }),
});

/**
 * 3. 外部原始事件 (External Raw Events)
 */
export const DiscordMessageEventSchema = EventMetadataSchema.extend({
  type: z.literal("discord.message.received"),
  source: z.literal("discord"),
  payload: z.object({
    // 携带全量摘要，确保 Gateway 判定逻辑不失效
    message: z.any().describe("DiscordMessageSummary 完整对象"),
  }),
});

export const LiveEventReceivedSchema = EventMetadataSchema.extend({
  type: z.literal("live.event.received"),
  source: z.literal("system"),
  payload: z.record(z.any()).describe("原始直播事件载荷"),
});

/**
 * 4. 指令下发类事件 (Directive Events)
 */
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
    target: z.enum(["discord", "live", "global"]),
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
const SystemTypes = z.enum(["system.ready", "system.error", "system.shutdown"]);
export const SystemEventSchema = EventMetadataSchema.extend({
  type: SystemTypes,
  payload: z.record(z.any()).optional(),
});

/**
 * 统一事件联合类型
 */
export const StelleEventSchema = z.union([
  TickEventSchema,
  ReflectionEventSchema,
  DiscordMessageEventSchema,
  LiveEventReceivedSchema, // 新增
  LiveRequestEventSchema,
  DirectiveEventSchema,
  SystemEventSchema,
]);

export type StelleEvent = z.infer<typeof StelleEventSchema>;
export type StelleEventType = StelleEvent["type"];
