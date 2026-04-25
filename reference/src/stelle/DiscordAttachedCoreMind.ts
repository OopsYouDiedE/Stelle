/**
 * ============================================================================
 * 主要功能模块概览：
 * * 1. DiscordAttachedCoreMind (主类)
 * - 核心控制器，绑定 Discord 客户端与 AI 核心 (CoreMind)。
 * - 监听消息、管理打字状态、维护频道注意力状态（冷却、等待、激活等）。
 * - 分发消息到对应的游标 (Cursor) 或者执行相应的路由策略。
 * * 2. DiscordRouteDecider (路由决策器)
 * - 判断收到的消息应该由轻量级的 Cursor 本地处理，还是需要唤醒重型的主大脑 (Stelle) 处理。
 * - 识别高风险指令、直播动作 (Live)、社交动作等。
 * * 3. DiscordJudge (对话裁判)
 * - 决定 AI 在当前频道的对话中“是否需要插话”、“何时插话”。
 * - 处理群聊环境下的环境音 (Ambient) 插话逻辑（例如等待沉默、等待特定关键词）。
 * * 4. DiscordReplyComposer (回复生成器)
 * - 组装 Prompt 并调用文本生成模型 (GeminiTextProvider) 生成最终回复文本。
 * - 包含处理核心回复、游标快捷回复、以及带工具循环检索的回复生成逻辑。
 * * 5. 治理与权限函数 (Governance)
 * - 管理谁有权限在 Discord 服务器内开启/关闭机器人的回复，或者添加管理员。
 * ============================================================================
 */

import "dotenv/config";
import { Events, PermissionsBitField, type Client, type Message } from "discord.js";
import { DiscordServerConfigStore } from "../StelleConfig.js";
import { CoreMind, CursorRegistry, CursorRuntime } from "../CoreMind.js";
import { InnerCursor } from "../cursors/BaseCursor.js";
import { DiscordCursor } from "../cursors/DiscordCursor.js";
import { LiveCursor } from "../cursors/LiveCursor.js";
import { loadStelleModelConfig } from "../StelleConfig.js";
import type {
  DiscordAttentionState,
  DiscordClosedSegment,
  DiscordJudgeDecision,
  DiscordMessageSummary,
  DiscordReplyIntent,
  DiscordStoredJudgeDecision,
  DiscordWaitCondition,
} from "../DiscordRuntime.js";
import { DiscordJsRuntime, formatDiscordMessage } from "../DiscordRuntime.js";
import { MemoryManager } from "../MemoryManager.js";
import { renderPromptTemplate } from "../PromptTemplates.js";
import { collectTextStream, GeminiTextProvider, sanitizeExternalText } from "../TextStream.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import type { ContextStreamItem, ToolResult } from "../types.js";
import { LiveContentController as StelleLiveContentController } from "./LiveContentController.js";

// ============================================================================
// [1] 接口与类型定义
// ============================================================================

export interface DiscordAttachedCoreMindOptions {
  token?: string;
  cursorId?: string;
  defaultChannelId?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxReplyChars?: number;
  synthesizeReplies?: boolean;
  discordCooldownSeconds?: number;
  discordDmSilenceSeconds?: number;
  discordSegmentIdleSeconds?: number;
  discordDormantIdleSeconds?: number;
  client?: Client;
  textProvider?: GeminiTextProvider;
}

export interface DiscordCoreMindMessageResult {
  observed: boolean;
  replied: boolean;
  reply?: ToolResult;
  reason: string;
  route?: "cursor" | "stelle" | "none";
}

type DiscordReplyMode = "direct" | "ambient";

interface DiscordMessageRouteContext {
  shouldReply: boolean;
  reason: string;
  dm: boolean;
  botUserId: string | null | undefined;
  mentioned: boolean;
  otherMentionIds: string[];
  decision: DiscordRouteDecision;
}

interface DiscordRespondOptions {
  reason: string;
  forceReply?: boolean;
  mode: DiscordReplyMode;
  allowEscalatedAmbient: boolean;
}

export interface DebugToolInvocationOptions {
  cursorId?: string;
  returnToInner?: boolean;
}

export interface DiscordHistoryDebugEntry {
  channelId: string;
  summary: string;
  recentHistory: string[];
  participantDirectory: string[];
  fullHistory: string[];
}

export type DiscordRoute = "cursor" | "stelle";

export interface DiscordRouteDecision {
  route: DiscordRoute;
  reason: string;
  needsVerification: boolean;
  intent:
    | "local_answer"
    | "stelle_reply"
    | "live_action"
    | "social_action"
    | "self_or_system"
    | "memory_or_continuity"
    | "high_risk";
}

export interface DiscordRouteInput {
  text: string;
  isDm: boolean;
  mentionedOtherUsers: boolean;
}

export interface DiscordAdminCommand {
  type: "channel_allow" | "channel_deny" | "manager_add" | "manager_remove" | "show_config";
  targetUserId?: string;
}

// ============================================================================
// [2] 主核心大脑绑定类
// ============================================================================

export class DiscordAttachedCoreMind {
  readonly cursors = new CursorRegistry();
  readonly tools;
  readonly cursorRuntime: CursorRuntime;
  readonly discordRuntime: DiscordJsRuntime;
  readonly innerCursor: InnerCursor;
  readonly discordCursor: DiscordCursor;
  readonly liveCursor: LiveCursor;
  readonly memory: MemoryManager;
  core!: CoreMind;

  private readonly client: Client;
  private readonly textProvider: GeminiTextProvider | null;
  private readonly ownsClient: boolean;
  private readonly ownerUserId = process.env.DISCORD_OWNER_USER_ID ?? null;
  private readonly discordConfig = new DiscordServerConfigStore();
  private readonly routeDecider: DiscordRouteDecider;
  private readonly discordJudge: DiscordJudge;
  private readonly replyComposer: DiscordReplyComposer;
  private liveController!: StelleLiveContentController;
  
  // 各种定时器
  private liveTickTimer?: ReturnType<typeof setInterval>;
  private readonly waitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly attentionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly typingState = new Map<string, Map<string, number>>(); // 频道 -> 用户 -> 打字时间

  // 参数配置
  private readonly cooldownSeconds: number;
  private readonly dmSilenceSeconds: number;
  private readonly segmentIdleSeconds: number;
  private readonly dormantIdleSeconds: number;

  constructor(private readonly options: DiscordAttachedCoreMindOptions = {}) {
    this.client = options.client ?? DiscordJsRuntime.createClient();
    this.ownsClient = !options.client;
    this.discordRuntime = new DiscordJsRuntime(this.client);
    
    // 初始化游标系统
    this.innerCursor = new InnerCursor();
    this.discordCursor = new DiscordCursor(this.discordRuntime, {
      id: options.cursorId ?? "discord",
      defaultChannelId: options.defaultChannelId,
    });
    this.liveCursor = new LiveCursor();
    
    // 内存管理器监听直播事件
    this.memory = new MemoryManager({ innerCursor: this.innerCursor });
    this.liveCursor.live.setEventSink((event) => {
      this.memory.publish(this.memory.createLiveActionEvent(event));
    });

    this.cursors.register(this.innerCursor);
    this.cursors.register(this.discordCursor);
    this.cursors.register(this.liveCursor);

    this.tools = createDefaultToolRegistry(this.cursors);
    this.cursorRuntime = new CursorRuntime(this.cursors, this.tools);

    // 模型配置
    const modelConfig = loadStelleModelConfig();
    const apiKey = options.apiKey ?? modelConfig.apiKey;
    const maxReplyChars = options.maxReplyChars ?? 900;
    this.textProvider = apiKey
      ? options.textProvider ?? new GeminiTextProvider({
          config: {
            ...modelConfig,
            apiKey,
            baseUrl: options.baseUrl ?? modelConfig.baseUrl,
            primaryModel: options.model ?? modelConfig.primaryModel,
          },
        })
      : null;

    // 初始化各个子模块
    this.routeDecider = new DiscordRouteDecider(this.textProvider);
    this.discordJudge = new DiscordJudge(this.textProvider, this.discordCursor);
    this.replyComposer = new DiscordReplyComposer(
      this.textProvider,
      this.cursorRuntime,
      this.discordCursor,
      maxReplyChars
    );

    // 默认配置回退
    this.cooldownSeconds = Math.max(30, options.discordCooldownSeconds ?? Number(process.env.DISCORD_COOLDOWN_SECONDS ?? 240));
    this.dmSilenceSeconds = Math.max(2, options.discordDmSilenceSeconds ?? Number(process.env.DISCORD_DM_SILENCE_SECONDS ?? 4));
    this.segmentIdleSeconds = Math.max(45, options.discordSegmentIdleSeconds ?? Number(process.env.DISCORD_SEGMENT_IDLE_SECONDS ?? 150));
    this.dormantIdleSeconds = Math.max(120, options.discordDormantIdleSeconds ?? Number(process.env.DISCORD_DORMANT_IDLE_SECONDS ?? 600));
  }

  // --- 生命周期 ---
  async start(): Promise<void> {
    await this.memory.start();
    this.core = await CoreMind.create({
      cursors: this.cursors,
      tools: this.tools,
      defaultCursorId: this.innerCursor.identity.id,
    });
    this.liveController = new StelleLiveContentController(
      this.core,
      this.textProvider,
      this.options.maxReplyChars ?? 900,
      (text) => this.memory.recallForLivePrompt(text)
    );

    // 监听 Discord 消息
    this.client.on(Events.MessageCreate, (message) => {
      void this.handleDiscordMessage(message).catch((error) => {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(`[Stelle] Discord message handling failed: ${detail}`);
        this.core.handleEscalation(`Discord message handling failed: ${detail}`);
      });
    });

    // 监听打字状态
    this.client.on(Events.TypingStart, (typing) => {
      if (typing.user?.bot) return;
      const users = this.typingState.get(typing.channel.id) ?? new Map<string, number>();
      users.set(typing.user.id, Date.now());
      this.typingState.set(typing.channel.id, users);
    });

    const token = this.options.token ?? process.env.DISCORD_TOKEN;
    if (!token) throw new Error("Missing DISCORD_TOKEN.");

    await this.discordRuntime.login(token);
    await this.syncPresence();
    this.startLiveTickLoop();
  }

  async stop(): Promise<void> {
    if (this.liveTickTimer) clearInterval(this.liveTickTimer);
    for (const timer of this.waitTimers.values()) clearTimeout(timer);
    for (const timer of this.attentionTimers.values()) clearTimeout(timer);
    this.waitTimers.clear();
    this.attentionTimers.clear();
    await this.memory.flush();
    if (this.ownsClient) await this.discordRuntime.destroy();
  }

  // --- 核心：消息处理主入口 ---
  async handleDiscordMessage(message: Message): Promise<DiscordCoreMindMessageResult> {
    if (message.author.bot) return this.noReply("ignored bot message", false);

    const summary = formatDiscordMessage(message);
    this.applyGuildAlias(message, summary); // 转换用户在群组内的昵称

    const channelActivated = summary.guildId ? this.discordConfig.isChannelActivated(summary.channelId) : true;
    const mentionedBot = Boolean(this.client.user?.id && summary.mentionedUserIds?.includes(this.client.user.id));
    
    // 检查是否是管理命令
    const adminCommand = parseDiscordAdminCommand(summary.content, this.client.user?.id ?? null);
    if (adminCommand && (mentionedBot || !summary.guildId)) {
      return this.handleGovernanceCommand(message, summary, adminCommand);
    }

    // 频道未激活且未被 @
    if (summary.guildId && !channelActivated && !mentionedBot) {
      return this.noReply("channel not activated", false);
    }

    // 接收消息并更新上下文
    await this.discordCursor.receiveMessage(summary);
    await this.discordCursor.tick();
    await this.syncAttentionLifecycle(summary.channelId);
    this.scheduleAttentionTimer(summary.channelId);

    const session = this.discordCursor.getChannelSession(summary.channelId);
    if (mentionedBot) session?.leaveDormant();

    // 根据消息类型决定处理逻辑
    let result = !summary.guildId
      ? await this.handleDirectMessage(summary)
      : mentionedBot
        ? await this.respondToMessage(summary, {
            reason: "direct mention",
            forceReply: true,
            mode: "direct",
            allowEscalatedAmbient: true,
          })
        : await this.handleAmbientChannelMessage(summary);

    if (!result.observed) result = { ...result, observed: true };
    
    // 将行为记录到记忆模块
    this.memory.publish(
      this.memory.createDiscordMessageEvent({
        message: summary,
        dm: !summary.guildId,
        mentionedBot,
        replyRequired: result.replied,
        channelActivated,
        route: result.route,
        intent: result.reason,
      })
    );
    return result;
  }

  // --- 消息处理分支 ---

  /** 处理群组中的普通（未 @ 机器人）消息，决定是否插话 */
  private async handleAmbientChannelMessage(summary: DiscordMessageSummary): Promise<DiscordCoreMindMessageResult> {
    const session = this.discordCursor.getChannelSession(summary.channelId);
    if (!session) return this.noReply("missing channel session");

    this.cancelWaitTimer(summary.channelId);

    if (session.isProcessing) return this.noReply("reply already in progress");
    if (session.isMuted()) return this.noReply("channel temporarily muted");
    if (session.attentionState === "cooldown") {
      this.scheduleAttentionTimer(summary.channelId);
      return this.noReply("channel attention cooling down");
    }
    if (session.isDormant()) return this.noReply("channel attention is dormant until direct mention");

    session.expireWaitCondition();
    const existing = session.waitCond;

    // 如果之前处于等待插话状态，检查触发条件
    if (existing) {
      const triggered = await this.maybeExecuteWaitCondition(summary.channelId, existing, "existing_wait_condition");
      if (triggered) return triggered;
      if (existing.type === "silence") {
        session.engage({
          focus: session.focus,
          intentSummary: session.intentSummary,
          state: "waiting",
          attentionWindowSeconds: this.segmentIdleSeconds,
        });
        this.scheduleWait(summary.channelId, existing);
        this.scheduleAttentionTimer(summary.channelId);
      }
      return this.noReply(`waiting for ${existing.type}`);
    }

    // 调用法官判断是否应该关心这句话
    const judge = await this.discordJudge.decide({
      latestText: summary.content,
      channelId: summary.channelId,
      isDm: false,
      mentionedBot: false,
      attentionState: session.attentionState,
      previousJudgeDecision: session.getLastJudgeDecision(),
      currentReplyIntent: session.getCurrentReplyIntent(),
    });

    if (judge.action === "drop" || !judge.interestMatched) {
      if (judge.reactivation === "direct_only" && session.hasOpenSegment()) {
        await this.closeAttentionSegment(summary.channelId, `judge_drop:${judge.intent.angle}`, "dormant");
      }
      return this.noReply(judge.interestMatched ? "judge dropped ambient engagement" : "judge found no interest match");
    }

    const waitCond = this.judgeDecisionToWaitCondition(judge, { mode: "ambient", allowEscalatedRoute: false });
    session.storeJudgeDecision(
      this.toStoredJudgeDecision(judge),
      this.toReplyIntent(judge, { mode: "ambient", routeHint: "cursor_only" })
    );
    session.engage({
      focus: judge.focus.topic,
      intentSummary: `${judge.intent.stance}: ${judge.intent.angle}`,
      state: waitCond.fireNow ? "engaged" : "waiting",
      attentionWindowSeconds: judge.attentionWindowSeconds,
    });
    session.setWaitCondition(waitCond);
    this.scheduleAttentionTimer(summary.channelId);

    // 检查新的等待条件是否立即触发
    const triggered = await this.maybeExecuteWaitCondition(summary.channelId, waitCond, "judge_decision");
    if (triggered) return triggered;
    
    if (waitCond.type === "silence") {
      this.scheduleWait(summary.channelId, waitCond);
    }
    return this.noReply(`judge decided ${waitCond.type}`);
  }

  /** 处理私聊消息 */
  private async handleDirectMessage(summary: DiscordMessageSummary): Promise<DiscordCoreMindMessageResult> {
    const session = this.discordCursor.getChannelSession(summary.channelId);
    if (!session) return this.noReply("missing channel session");

    this.cancelWaitTimer(summary.channelId);

    if (session.isProcessing) return this.noReply("reply already in progress");
    if (session.isMuted()) return this.noReply("channel temporarily muted");

    const judge = await this.discordJudge.decide({
      latestText: summary.content,
      channelId: summary.channelId,
      isDm: true,
      mentionedBot: false,
      attentionState: session.attentionState,
      previousJudgeDecision: session.getLastJudgeDecision(),
      currentReplyIntent: session.getCurrentReplyIntent(),
    });

    const waitCond = this.judgeDecisionToWaitCondition(
      {
        ...judge,
        trigger: {
          ...judge.trigger,
          conditionValue: judge.trigger.conditionType === "silence"
              ? Number(judge.trigger.conditionValue) || this.dmSilenceSeconds
              : judge.trigger.conditionValue,
        },
      },
      { mode: "direct", allowEscalatedRoute: true }
    );

    session.engage({
      focus: judge.focus.topic,
      intentSummary: `${judge.intent.stance}: ${judge.intent.angle}`,
      state: "waiting",
      attentionWindowSeconds: judge.attentionWindowSeconds,
    });
    session.storeJudgeDecision(
      this.toStoredJudgeDecision(judge),
      this.toReplyIntent(judge, { mode: "direct", routeHint: "escalation_allowed" })
    );
    session.setWaitCondition(waitCond);

    const triggered = await this.maybeExecuteWaitCondition(summary.channelId, waitCond, "direct_judge");
    if (triggered) return triggered;
    
    if (waitCond.type === "silence") {
      this.scheduleWait(summary.channelId, waitCond);
      this.scheduleAttentionTimer(summary.channelId);
      return this.noReply(`dm waiting for ${waitCond.type}`);
    }

    return this.respondToMessage(summary, {
      reason: "dm direct response",
      forceReply: true,
      mode: "direct",
      allowEscalatedAmbient: true,
    });
  }

  // --- 核心响应逻辑 ---

  /** 生成回复，按路由策略分发给大模型、小模型或者特定动作 */
  private async respondToMessage(
    summary: DiscordMessageSummary,
    options: DiscordRespondOptions
  ): Promise<DiscordCoreMindMessageResult> {
    const session = this.discordCursor.getChannelSession(summary.channelId);
    const routeContext = await this.buildRouteContext(summary, options);

    if (!routeContext.shouldReply) return this.noReply(routeContext.reason);

    // 检查 Ambient 插话是否允许越级到主大脑 (Stelle)
    if (!options.allowEscalatedAmbient && routeContext.decision.route !== "cursor") {
      if (options.mode === "ambient" && session?.hasOpenSegment()) {
        await this.closeAttentionSegment(summary.channelId, `ambient_escalation_blocked:${routeContext.decision.intent}`, "dormant");
      }
      return this.noReply(`ambient route skipped: ${routeContext.decision.intent}`);
    }

    // 合成临时的裁判决定以供记忆参考
    if (session && !session.getCurrentReplyIntent()) {
      const syntheticJudge = this.syntheticJudgeDecision(summary, options.mode);
      session.storeJudgeDecision(
        this.toStoredJudgeDecision(syntheticJudge),
        this.toReplyIntent(syntheticJudge, { mode: options.mode, routeHint: options.allowEscalatedAmbient ? "escalation_allowed" : "cursor_only" })
      );
    }

    const memoryContext = await this.memory.recallForDiscordMessage(summary);
    this.cancelWaitTimer(summary.channelId);
    session?.clearWaitCondition();
    
    if (session && !session.hasOpenSegment()) {
      session.engage({
        focus: session.focus || summary.content.slice(0, 80),
        intentSummary: session.intentSummary || options.reason,
        state: "engaged",
        attentionWindowSeconds: this.segmentIdleSeconds,
      });
    }
    session?.beginProcessing();

    try {
      let result: DiscordCoreMindMessageResult;
      // 根据路由选择响应方式
      if (routeContext.decision.route === "cursor") {
        result = await this.handleCursorRoute(summary, routeContext.dm, routeContext.botUserId, routeContext.decision, memoryContext, options.mode);
      } else if (routeContext.decision.intent === "live_action") {
        result = await this.handleLiveRoute(summary, memoryContext);
      } else if (routeContext.decision.intent === "social_action") {
        result = await this.handleSocialRoute(summary, routeContext.otherMentionIds);
      } else {
        result = await this.handleStelleReplyRoute(summary, routeContext.dm, routeContext.decision.intent, memoryContext);
      }

      if (result.replied) {
        if (routeContext.dm) {
          await this.closeAttentionSegment(summary.channelId, "dm_turn_complete", "cold");
        } else {
          session?.enterCooldown(this.cooldownSeconds); // 群聊开启冷却防刷屏
          this.scheduleAttentionTimer(summary.channelId);
        }
      }
      return result;
    } finally {
      session?.endProcessing();
    }
  }

  // --- 工具、封装与其他发送方法省略化简 ---
  // 发送消息快捷封装
  async sendStelleDiscordMessage(input: { channel_id: string; content: string; mention_user_ids?: string[]; reply_to_message_id?: string; }): Promise<ToolResult> {
    return this.runOnCursor(this.discordCursor.identity.id, "send Discord message", () => this.core.useTool("discord.stelle_send_message", input), true);
  }

  // 构建路由上下文
  private async buildRouteContext(summary: DiscordMessageSummary, options: { forceReply?: boolean; reason?: string } = {}): Promise<DiscordMessageRouteContext> {
    const status = await this.discordRuntime.getStatus();
    const dm = !summary.guildId;
    const otherMentionIds = (summary.mentionedUserIds ?? []).filter((id) => id !== status.botUserId && id !== summary.author.id);
    const mentioned = Boolean(status.botUserId && summary.mentionedUserIds?.includes(status.botUserId));
    const shouldReply = mentioned || dm || options.forceReply === true;
    
    return {
      shouldReply,
      reason: options.reason ?? (shouldReply ? "reply required" : "observed without direct mention"),
      dm,
      botUserId: status.botUserId,
      mentioned,
      otherMentionIds,
      decision: await this.routeDecider.decide({ text: summary.content, isDm: dm, mentionedOtherUsers: otherMentionIds.length > 0 }),
    };
  }

  // ... 更多具体路由处理实现 ...
  private async handleCursorRoute(message: DiscordMessageSummary, dm: boolean, botUserId: string | null | undefined, decision: DiscordRouteDecision, memoryContext: string, mode: "direct" | "ambient"): Promise<DiscordCoreMindMessageResult> {
    const replyIntent = this.discordCursor.getChannelSession(message.channelId)?.getCurrentReplyIntent();
    const replyText = await this.replyComposer.generateCursorReply(message.content, message.channelId, { decision, mode, replyIntent }, memoryContext);
    
    const canPassiveMentionReply = !dm && Boolean(botUserId && this.discordCursor.canReplyToMention(message, botUserId));
    const reply = dm
      ? await this.cursorRuntime.useCursorTool("discord", "discord.cursor_reply_direct", { channel_id: message.channelId, message_id: message.id, content: replyText })
      : canPassiveMentionReply
        ? await this.cursorRuntime.useCursorTool("discord", "discord.cursor_reply_mention", { channel_id: message.channelId, message_id: message.id, content: replyText })
        : await this.sendStelleDiscordMessage({ channel_id: message.channelId, content: replyText, reply_to_message_id: message.id });

    await this.captureReplyMemory(reply, "cursor", message);
    return this.messageResult("cursor", reply);
  }

  private async handleLiveRoute(message: DiscordMessageSummary, _memoryContext: string): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.liveCursor.identity.id, "Discord route requested live action");
    const live = await this.liveController.handleRequest({ text: message.content, source: "discord_command", trustedInput: Boolean(message.trustedInput), authorId: message.author.id });
    const ack = await this.sendStelleDiscordMessage({ channel_id: message.channelId, content: live.summary, reply_to_message_id: message.id });
    await this.captureReplyMemory(ack, "stelle", message);
    return this.messageResult("stelle", ack, live.summary);
  }

  private async handleSocialRoute(message: DiscordMessageSummary, otherMentionIds: string[]): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.discordCursor.identity.id, "Discord route requested targeted social action");
    const replyText = await this.replyComposer.generateSocialReply(message.content, otherMentionIds);
    const reply = await this.sendStelleDiscordMessage({ channel_id: message.channelId, content: replyText, mention_user_ids: otherMentionIds, reply_to_message_id: message.id });
    await this.captureReplyMemory(reply, "stelle", message);
    return this.messageResult("stelle", reply);
  }

  private async handleStelleReplyRoute(message: DiscordMessageSummary, dm: boolean, intent: string, memoryContext: string): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.discordCursor.identity.id, `Discord route escalated: ${intent}`);
    const observation = await this.core.observeCurrentCursor();
    const replyIntent = this.discordCursor.getChannelSession(message.channelId)?.getCurrentReplyIntent();
    const replyText = await this.replyComposer.generateCoreReply(observation.stream, message.content, memoryContext, replyIntent);

    if (this.options.synthesizeReplies ?? process.env.DISCORD_TTS_ENABLED === "true") {
      await this.core.useTool("tts.kokoro_stream_speech", { text: replyText, file_prefix: `discord-reply-${message.id}` });
    }

    const reply = dm
      ? await this.sendStelleDiscordMessage({ channel_id: message.channelId, content: replyText, reply_to_message_id: message.id })
      : await this.core.useTool("discord.cursor_reply_mention", { channel_id: message.channelId, message_id: message.id, content: replyText });

    await this.captureReplyMemory(reply, "stelle", message);
    return this.messageResult("stelle", reply);
  }

  // --- 状态与工具类成员方法 ---
  private async switchCursor(cursorId: string, reason: string): Promise<void> {
    await this.core.switchCursor(cursorId, reason);
    await this.syncPresence();
  }

  private async runOnCursor<T>(cursorId: string, reason: string, action: () => Promise<T>, returnToInner: boolean): Promise<T> {
    if (this.core.attachment.currentCursorId !== cursorId) await this.switchCursor(cursorId, reason);
    try {
      return await action();
    } finally {
      if (returnToInner && this.core.attachment.currentCursorId !== this.innerCursor.identity.id) {
        await this.core.returnToInnerCursor(`${reason} finished`);
        await this.syncPresence();
      }
    }
  }

  private async syncPresence(): Promise<void> {
    await this.discordRuntime.setBotPresence?.({ window: this.core.attachment.currentCursorId, detail: this.core.attachment.mode });
  }

  private noReply(reason: string, observed = true): DiscordCoreMindMessageResult {
    return { observed, replied: false, reason, route: "none" };
  }

  private messageResult(route: "cursor" | "stelle", reply: ToolResult, reason = reply.summary): DiscordCoreMindMessageResult {
    return { observed: true, replied: reply.ok, reply, reason, route };
  }
  
  // 各种帮助判定、打字状态记录等工具函数 (省略多余细节，核心已注释)
  private isSomeoneTyping(channelId: string): boolean {
    const users = this.typingState.get(channelId);
    if (!users) return false;
    const now = Date.now();
    for (const [userId, timestamp] of [...users.entries()]) {
      if (now - timestamp > 6000) users.delete(userId);
    }
    if (!users.size) this.typingState.delete(channelId);
    return users.size > 0;
  }
  
  // ... 等待条件检查、定时器调度逻辑保持原样以维持功能完整
  private scheduleWait(channelId: string, condition: DiscordWaitCondition): void { /*...*/ }
  private cancelWaitTimer(channelId: string): void { /*...*/ }
  private async maybeExecuteWaitCondition(channelId: string, condition: DiscordWaitCondition, reason: string): Promise<DiscordCoreMindMessageResult | null> { return null; /* 实现省略 */ }
  private async closeAttentionSegment(channelId: string, reason: string, nextState: "cold" | "dormant"): Promise<void> { /*...*/ }
  private startLiveTickLoop(): void { /*...*/ }
  private applyGuildAlias(message: Message, summary: DiscordMessageSummary): void { /*...*/ }
  private async syncAttentionLifecycle(channelId: string): Promise<void> { /*...*/ }
  private scheduleAttentionTimer(channelId: string): void { /*...*/ }
  private cancelAttentionTimer(channelId: string): void { /*...*/ }
  private judgeDecisionToWaitCondition(judge: DiscordJudgeDecision, options: { mode: "direct" | "ambient"; allowEscalatedRoute: boolean }): DiscordWaitCondition { return {} as any; }
  private toStoredJudgeDecision(judge: DiscordJudgeDecision): DiscordStoredJudgeDecision { return {} as any; }
  private toReplyIntent(judge: DiscordJudgeDecision, options: { mode: "direct" | "ambient"; routeHint: "cursor_only" | "escalation_allowed"; }): DiscordReplyIntent { return {} as any; }
  private syntheticJudgeDecision(summary: DiscordMessageSummary, mode: "direct" | "ambient"): DiscordJudgeDecision { return {} as any; }
  private async captureReplyMemory(result: ToolResult, route: "cursor" | "stelle" | "governance" | "debug", sourceMessage?: DiscordMessageSummary): Promise<void> { /*...*/ }

  // 治理权限
  private async handleGovernanceCommand(message: Message, summary: DiscordMessageSummary, command: DiscordAdminCommand): Promise<DiscordCoreMindMessageResult> {
    if (!summary.guildId) return this.governanceResult(summary, "这类管理命令只能在服务器频道里使用。", "guild command required");
    // 管理逻辑...
    return this.governanceResult(summary, "指令已处理", "governance executed");
  }
  private async governanceResult(summary: DiscordMessageSummary, content: string, reason: string): Promise<DiscordCoreMindMessageResult> { return this.noReply("governance"); }
}

// ============================================================================
// [3] 路由决策器
// ============================================================================

export class DiscordRouteDecider {
  constructor(private readonly textProvider: GeminiTextProvider | null) {}

  async decide(input: DiscordRouteInput): Promise<DiscordRouteDecision> {
    const text = input.text.replace(/<@!?\d+>/g, " ").replace(/\s+/g, " ").trim();
    
    // 快速正则匹配一些高优动作，避免次次调用大模型
    if (/密码|token|api.?key|密钥|删库|自杀|诈骗/i.test(text)) return { route: "stelle", reason: "高风险指令", needsVerification: false, intent: "high_risk" };
    if (/直播|推流|obs|live2d|上播/i.test(text)) return { route: "stelle", reason: "直播动作", needsVerification: false, intent: "live_action" };
    if (input.mentionedOtherUsers && /调戏|吐槽|cue他|叫她/i.test(text)) return { route: "stelle", reason: "特定社交动作", needsVerification: false, intent: "social_action" };
    if (/stelle|core mind|大脑|游标|cursor/i.test(text)) return { route: "stelle", reason: "系统状态查询", needsVerification: false, intent: "self_or_system" };
    if (/记住|记忆|忘掉|遗忘/i.test(text)) return { route: "stelle", reason: "记忆变更", needsVerification: false, intent: "memory_or_continuity" };

    if (!this.textProvider) return { route: "cursor", reason: "缺省本地处理", needsVerification: false, intent: "local_answer" };

    // 如果以上均不满足，抛给语言模型进行决策
    // 此处调用模型 prompt: discord/route_decider ...
    return { route: "cursor", reason: "默认游标处理", needsVerification: false, intent: "local_answer" };
  }
}

// ============================================================================
// [4] Discord 法官 (插话决策)
// ============================================================================

export class DiscordJudge {
  constructor(private readonly textProvider: GeminiTextProvider | null, private readonly discordCursor: DiscordCursor) {}

  /** 决定在当前上下文中是否应该插话 */
  async decide(input: {
    latestText: string; channelId: string; isDm: boolean; mentionedBot: boolean;
    attentionState?: DiscordAttentionState; previousJudgeDecision?: DiscordStoredJudgeDecision; currentReplyIntent?: DiscordReplyIntent;
  }): Promise<DiscordJudgeDecision> {
    
    // 私聊直接回复，但稍作延迟(wait)假装在思考
    if (input.isDm) {
      return this.buildDecision("wait", "dm turn in progress", "silence", 4, 45, "react", "wait for the DM sender to finish, then reply once", input.latestText);
    }
    // 被 @ 立即回复
    if (input.mentionedBot) {
      return this.buildDecision("reply", "direct reach-out", "never", null, 45, "react", "reply directly to the addressed message", input.latestText);
    }

    // 环境音(Ambient)聊天时，调用大模型或启发式算法判断是否插话
    // ...
    return this.buildDecision("drop", "no natural opening", "never", null, 90, "pass", "observe this segment, then step back", input.latestText);
  }

  // 辅助构建判决对象
  private buildDecision(action: any, think: string, conditionType: any, conditionValue: any, expiresAfter: number, stance: string, angle: string, text: string): DiscordJudgeDecision {
    return {
      action, interestMatched: true, reactivation: "normal", attentionWindowSeconds: 120,
      think, focus: { topic: text.slice(0, 80) || "chat", drifted: false },
      trigger: { fireNow: action === "reply", conditionType, conditionValue, expiresAfter },
      intent: { stance, angle }, recallUserId: null
    };
  }
}

// ============================================================================
// [5] 回复生成器
// ============================================================================

class DiscordReplyComposer {
  constructor(
    private readonly textProvider: GeminiTextProvider | null,
    private readonly cursorRuntime: CursorRuntime,
    private readonly discordCursor: DiscordCursor,
    private readonly maxReplyChars: number
  ) {}

  /** 由主大脑 Core 生成重量级回复 */
  async generateCoreReply(observationStream: ContextStreamItem[], latestText: string, memoryContext = "", replyIntent?: DiscordReplyIntent): Promise<string> {
    // 调用大模型 ...
    return "Core Reply Mock";
  }

  /** 由游标 Cursor 生成轻量级回复，带有思考循环 (如搜索网页) */
  async generateCursorReply(latestText: string, channelId: string, options?: any, memoryContext = ""): Promise<string> {
    // 工具循环调用尝试 ...
    return "Cursor Reply Mock";
  }

  /** 生成特定的社交动作回复 */
  async generateSocialReply(text: string, targetIds: string[]): Promise<string> {
    return `Stelle cue <@${targetIds[0]}> !`;
  }
}

// ============================================================================
// [6] 权限治理与工具函数
// ============================================================================

export function parseDiscordAdminCommand(text: string, botUserId?: string | null): DiscordAdminCommand | null {
  const normalized = botUserId ? text.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim() : text.trim();
  if (/^(允许|启用|开放)(本频道|这个频道|当前频道)$/.test(normalized)) return { type: "channel_allow" };
  if (/^(禁用|关闭|停止)(本频道|这个频道|当前频道)$/.test(normalized)) return { type: "channel_deny" };
  if (/^(查看|显示)(本服配置|频道配置|bot配置|管理配置)$/.test(normalized)) return { type: "show_config" };
  return null;
}

export function isDiscordAdmin(message: Message): boolean {
  if (!message.inGuild()) return false;
  return message.member?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
}

export async function startDiscordAttachedCoreMind(options: DiscordAttachedCoreMindOptions = {}) {
  const app = new DiscordAttachedCoreMind(options);
  await app.start();
  return app;
}