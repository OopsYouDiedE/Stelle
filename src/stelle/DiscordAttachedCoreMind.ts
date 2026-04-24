import "dotenv/config";
import { Events, type Client, type Message } from "discord.js";
import { DiscordServerConfigStore } from "../config/DiscordServerConfig.js";
import { CoreMind } from "../core/CoreMind.js";
import { CursorRegistry } from "../core/CursorRegistry.js";
import { CursorRuntime } from "../core/CursorRuntime.js";
import { DiscordCursor } from "../cursors/discord/DiscordCursor.js";
import { InnerCursor } from "../cursors/InnerCursor.js";
import { LiveCursor } from "../cursors/live/LiveCursor.js";
import { loadStelleModelConfig } from "../config/StelleConfig.js";
import type { DiscordMessageSummary } from "../discord/types.js";
import { DiscordJsRuntime, formatDiscordMessage } from "../discord/DiscordRuntime.js";
import { GeminiTextProvider } from "../gemini/GeminiTextProvider.js";
import { MemoryManager } from "../memory/MemoryManager.js";
import { createDefaultToolRegistry } from "../tools/index.js";
import type { ToolResult } from "../types.js";
import { DiscordLiveController } from "./DiscordLiveController.js";
import {
  canEditManagers,
  canManageDiscordBot,
  parseDiscordAdminCommand,
  type DiscordAdminCommand,
} from "./DiscordGovernance.js";
import { DiscordReplyComposer } from "./DiscordReplyComposer.js";
import { DiscordRouteDecider } from "./DiscordRouteDecider.js";
import type {
  DebugToolInvocationOptions,
  DiscordAttachedCoreMindOptions,
  DiscordCoreMindMessageResult,
  DiscordHistoryDebugEntry,
} from "./DiscordAttachedCoreMindTypes.js";

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
  private readonly routeDecider = new DiscordRouteDecider();
  private readonly replyComposer: DiscordReplyComposer;
  private liveController!: DiscordLiveController;
  private liveTickTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly options: DiscordAttachedCoreMindOptions = {}) {
    this.client = options.client ?? DiscordJsRuntime.createClient();
    this.ownsClient = !options.client;
    this.discordRuntime = new DiscordJsRuntime(this.client);
    this.innerCursor = new InnerCursor();
    this.discordCursor = new DiscordCursor(this.discordRuntime, {
      id: options.cursorId ?? "discord",
      defaultChannelId: options.defaultChannelId,
    });
    this.liveCursor = new LiveCursor();
    this.memory = new MemoryManager({ innerCursor: this.innerCursor });
    this.liveCursor.live.setEventSink((event) => {
      this.memory.publish(
        this.memory.createLiveActionEvent({
          action: event.action,
          ok: event.ok,
          summary: event.summary,
          timestamp: event.timestamp,
          text: event.text,
          stage: event.stage,
          obs: event.obs,
          source: event.source,
          metadata: event.metadata,
        })
      );
    });

    this.cursors.register(this.innerCursor);
    this.cursors.register(this.discordCursor);
    this.cursors.register(this.liveCursor);

    this.tools = createDefaultToolRegistry(this.cursors);
    this.cursorRuntime = new CursorRuntime(this.cursors, this.tools);

    const modelConfig = loadStelleModelConfig();
    const apiKey = options.apiKey ?? modelConfig.apiKey;
    const maxReplyChars = options.maxReplyChars ?? 900;
    this.textProvider = apiKey
      ? options.textProvider ??
        new GeminiTextProvider({
          config: {
            ...modelConfig,
            apiKey,
            baseUrl: options.baseUrl ?? modelConfig.baseUrl,
            primaryModel: options.model ?? modelConfig.primaryModel,
          },
        })
      : null;

    this.replyComposer = new DiscordReplyComposer(
      this.textProvider,
      this.cursorRuntime,
      this.discordCursor,
      maxReplyChars
    );
  }

  async start(): Promise<void> {
    await this.memory.start();
    this.core = await CoreMind.create({
      cursors: this.cursors,
      tools: this.tools,
      defaultCursorId: this.innerCursor.identity.id,
    });
    this.liveController = new DiscordLiveController(
      this.core,
      this.textProvider,
      this.options.maxReplyChars ?? 900,
      (text) => this.memory.recallForLivePrompt(text)
    );

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleDiscordMessage(message).catch((error) => {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(`[Stelle] Discord message handling failed: ${detail}`);
        this.core.handleEscalation(
          `Discord message handling failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    });

    const token = this.options.token ?? process.env.DISCORD_TOKEN;
    if (!token) throw new Error("Missing DISCORD_TOKEN.");

    await this.discordRuntime.login(token);
    await this.syncPresence();
    this.startLiveTickLoop();
  }

  async stop(): Promise<void> {
    if (this.liveTickTimer) clearInterval(this.liveTickTimer);
    await this.memory.flush();
    if (this.ownsClient) await this.discordRuntime.destroy();
  }

  async handleDiscordMessage(message: Message): Promise<DiscordCoreMindMessageResult> {
    if (message.author.bot) {
      return this.noReply("ignored bot message", false);
    }

    const summary = formatDiscordMessage(message);
    this.applyGuildAlias(message, summary);

    const mentionedBot = Boolean(this.client.user?.id && summary.mentionedUserIds?.includes(this.client.user.id));
    const adminCommand = parseDiscordAdminCommand(summary.content, this.client.user?.id ?? null);
    if (adminCommand && (mentionedBot || !summary.guildId)) {
      return this.handleGovernanceCommand(message, summary, adminCommand);
    }

    if (summary.guildId && !this.discordConfig.isChannelActivated(summary.channelId)) {
      return this.noReply("channel not activated", false);
    }

    await this.discordCursor.receiveMessage(summary);
    await this.discordCursor.tick();

    const routeContext = await this.classifyMessage(summary);
    this.memory.publish(
      this.memory.createDiscordMessageEvent({
        message: summary,
        dm: routeContext.dm,
        mentionedBot,
        replyRequired: routeContext.shouldReply,
        channelActivated: true,
        route: routeContext.decision.route,
        intent: routeContext.decision.intent,
      })
    );
    const memoryContext = await this.memory.recallForDiscordMessage(summary);
    if (!routeContext.shouldReply) {
      return this.noReply(routeContext.reason);
    }

    console.log(
      `[Stelle] Discord route message=${summary.id} route=${routeContext.decision.route} intent=${routeContext.decision.intent} reason="${routeContext.decision.reason}"`
    );

    if (routeContext.decision.route === "cursor") {
      return this.handleCursorRoute(
        summary,
        routeContext.dm,
        routeContext.botUserId,
        routeContext.decision,
        memoryContext
      );
    }

    if (routeContext.decision.intent === "live_action") {
      return this.handleLiveRoute(summary, memoryContext);
    }

    if (routeContext.decision.intent === "social_action") {
      return this.handleSocialRoute(summary, routeContext.otherMentionIds);
    }

    return this.handleStelleReplyRoute(summary, routeContext.dm, routeContext.decision.intent, memoryContext);
  }

  async sendStelleDiscordMessage(input: {
    channel_id: string;
    content: string;
    mention_user_ids?: string[];
    reply_to_message_id?: string;
  }): Promise<ToolResult> {
    return this.runOnCursor(
      this.discordCursor.identity.id,
      "send Discord message",
      () => this.core.useTool("discord.stelle_send_message", input),
      true
    );
  }

  async useToolAsStelle(
    name: string,
    input: Record<string, unknown>,
    options: DebugToolInvocationOptions = {}
  ): Promise<ToolResult> {
    return this.runOnCursor(
      options.cursorId ?? this.core.attachment.currentCursorId,
      `debug tool invocation: ${name}`,
      () => this.core.useTool(name, input),
      options.returnToInner === true
    );
  }

  async switchCursorForDebug(cursorId: string, reason: string): Promise<void> {
    await this.switchCursor(cursorId, reason);
  }

  async observeCursorForDebug(cursorId?: string) {
    const targetCursorId = cursorId ?? this.core.attachment.currentCursorId;
    const cursor = this.cursors.get(targetCursorId);
    if (!cursor) throw new Error(`Unknown cursor: ${targetCursorId}`);
    return cursor.observe();
  }

  getDiscordLocalHistory(channelId?: string): DiscordHistoryDebugEntry[] {
    const snapshots = channelId
      ? this.discordCursor.listChannelSnapshots().filter((snapshot) => snapshot.channelId === channelId)
      : this.discordCursor.listChannelSnapshots();
    return snapshots.map((snapshot) =>
      this.buildDiscordHistoryEntry(snapshot.channelId, snapshot.summary, snapshot.recentHistory)
    );
  }

  async createDebugSnapshot(): Promise<Record<string, unknown>> {
    return {
      generatedAt: Date.now(),
      core: {
        identity: this.core.identity,
        attachment: this.core.attachment,
        deliberation: this.core.deliberation,
        continuity: this.core.continuity,
        toolView: this.core.toolView,
      },
      cursors: await this.collectCursorDebugViews(),
      currentObservation: await this.tryAsync(() => this.core.observeCurrentCursor()),
      tools: this.tools.describe(),
      decisions: [...this.core.decisions.slice(-120)].reverse(),
      audit: [...this.core.audit.records.slice(-120)].reverse(),
      discord: {
        status: await this.tryAsync(() => this.discordRuntime.getStatus(), { connected: false }),
        config: this.discordConfig.snapshot(),
        channels: this.discordCursor.listChannelSnapshots().map((snapshot) => ({
          ...snapshot,
          fullHistory: this.buildDiscordHistoryEntry(
            snapshot.channelId,
            snapshot.summary,
            snapshot.recentHistory
          ).fullHistory,
        })),
      },
      live: {
        status: await this.tryAsync(() => this.liveCursor.live.getStatus()),
        speechQueue: this.liveCursor.getSpeechQueue(),
      },
      memory: await this.memory.snapshot(),
    };
  }

  classifyRoute(text: string): "cursor" | "stelle" {
    return this.routeDecider.decide({ text, isDm: false, mentionedOtherUsers: false }).route;
  }

  private startLiveTickLoop(): void {
    const liveTickMs = Math.max(1200, Number(process.env.LIVE_SPEECH_TICK_MS ?? 4500));
    this.liveTickTimer = setInterval(() => {
      void this.liveCursor.tick().catch((error) => {
        this.core.handleEscalation(`Live Cursor tick failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, liveTickMs);
  }

  private async classifyMessage(summary: DiscordMessageSummary) {
    const status = await this.discordRuntime.getStatus();
    const botUserId = status.botUserId;
    const dm = !summary.guildId;
    const otherMentionIds = (summary.mentionedUserIds ?? []).filter(
      (id) => id !== botUserId && id !== summary.author.id
    );
    const mentioned = Boolean(botUserId && summary.mentionedUserIds?.includes(botUserId));
    const shouldReply = mentioned || dm;
    return {
      shouldReply,
      reason: shouldReply ? "reply required" : "observed without direct mention",
      dm,
      botUserId,
      otherMentionIds: shouldReply ? otherMentionIds : [],
      decision: this.routeDecider.decide({
        text: summary.content,
        isDm: dm,
        mentionedOtherUsers: shouldReply && otherMentionIds.length > 0,
      }),
    };
  }

  private async handleCursorRoute(
    message: DiscordMessageSummary,
    dm: boolean,
    botUserId: string | null | undefined,
    decision: ReturnType<DiscordRouteDecider["decide"]>,
    memoryContext: string
  ): Promise<DiscordCoreMindMessageResult> {
    const replyText = await this.replyComposer.generateCursorReply(
      message.content,
      message.channelId,
      decision,
      memoryContext
    );
    const reply = dm
      ? await this.cursorRuntime.useCursorTool("discord", "discord.cursor_reply_direct", {
          channel_id: message.channelId,
          message_id: message.id,
          content: replyText,
        })
      : await this.cursorRuntime.useCursorTool("discord", "discord.cursor_reply_mention", {
          channel_id: message.channelId,
          message_id: message.id,
          content: replyText,
        });

    if (!reply.ok && !dm && botUserId) {
      const fallback = await this.sendStelleDiscordMessage({
        channel_id: message.channelId,
        content: replyText,
        reply_to_message_id: message.id,
      });
      await this.captureReplyMemory(fallback, "cursor", message);
      return this.messageResult("cursor", fallback, fallback.summary);
    }

    await this.captureReplyMemory(reply, "cursor", message);
    return this.messageResult("cursor", reply);
  }

  private async handleLiveRoute(
    message: DiscordMessageSummary,
    _memoryContext: string
  ): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.liveCursor.identity.id, "Discord route requested live action");
    const live = await this.liveController.handleLiveCommand(message.content);
    const ack = await this.sendStelleDiscordMessage({
      channel_id: message.channelId,
      content: live.summary,
      reply_to_message_id: message.id,
    });
    await this.captureReplyMemory(ack, "stelle", message);
    return this.messageResult("stelle", ack, live.summary);
  }

  private async handleSocialRoute(
    message: DiscordMessageSummary,
    otherMentionIds: string[]
  ): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.discordCursor.identity.id, "Discord route requested targeted social action");
    const replyText = await this.replyComposer.generateSocialReply(message.content, otherMentionIds);
    const reply = await this.sendStelleDiscordMessage({
      channel_id: message.channelId,
      content: replyText,
      mention_user_ids: otherMentionIds,
      reply_to_message_id: message.id,
    });
    await this.captureReplyMemory(reply, "stelle", message);
    return this.messageResult("stelle", reply);
  }

  private async handleStelleReplyRoute(
    message: DiscordMessageSummary,
    dm: boolean,
    intent: string,
    memoryContext: string
  ): Promise<DiscordCoreMindMessageResult> {
    await this.switchCursor(this.discordCursor.identity.id, `Discord route escalated: ${intent}`);
    const observation = await this.core.observeCurrentCursor();
    const replyText = await this.replyComposer.generateCoreReply(observation.stream, message.content, memoryContext);

    if (this.options.synthesizeReplies ?? process.env.DISCORD_TTS_ENABLED === "true") {
      await this.core.useTool("tts.kokoro_stream_speech", {
        text: replyText,
        file_prefix: `discord-reply-${message.id}`,
      });
    }

    const reply = dm
      ? await this.sendStelleDiscordMessage({
          channel_id: message.channelId,
          content: replyText,
          reply_to_message_id: message.id,
        })
      : await this.core.useTool("discord.cursor_reply_mention", {
          channel_id: message.channelId,
          message_id: message.id,
          content: replyText,
        });

    await this.captureReplyMemory(reply, "stelle", message);
    return this.messageResult("stelle", reply);
  }

  private async captureReplyMemory(
    result: ToolResult,
    route: "cursor" | "stelle" | "governance" | "debug",
    sourceMessage?: DiscordMessageSummary
  ): Promise<void> {
    const message = extractDiscordMessage(result);
    if (!message) return;
    this.memory.publish(
      this.memory.createDiscordReplyEvent({
        message,
        route,
        targetUserId: sourceMessage?.author.id,
        targetUsername: sourceMessage?.author.username,
        targetMessageId: sourceMessage?.id,
      })
    );
  }

  private async syncPresence(): Promise<void> {
    await this.discordRuntime.setBotPresence?.({
      window: this.core.attachment.currentCursorId,
      detail: this.core.attachment.mode,
    });
  }

  private async switchCursor(cursorId: string, reason: string): Promise<void> {
    await this.core.switchCursor(cursorId, reason);
    await this.syncPresence();
  }

  private async runOnCursor<T>(
    cursorId: string,
    reason: string,
    action: () => Promise<T>,
    returnToInner: boolean
  ): Promise<T> {
    if (this.core.attachment.currentCursorId !== cursorId) {
      await this.switchCursor(cursorId, reason);
    }
    try {
      return await action();
    } finally {
      if (returnToInner && this.core.attachment.currentCursorId !== this.innerCursor.identity.id) {
        await this.core.returnToInnerCursor(`${reason} finished`);
        await this.syncPresence();
      }
    }
  }

  private buildDiscordHistoryEntry(channelId: string, summary: string, recentHistory: string[]): DiscordHistoryDebugEntry {
    return {
      channelId,
      summary,
      recentHistory: [...recentHistory],
      fullHistory: [...(this.discordCursor.getChannelSession(channelId)?.history ?? [])],
    };
  }

  private applyGuildAlias(message: Message, summary: DiscordMessageSummary): void {
    if (!message.guildId || message.author.bot) return;
    const sourceName =
      message.member?.displayName ||
      message.author.globalName ||
      summary.author.username;
    const alias = this.discordConfig.ensureAlias(message.guildId, message.author.id, sourceName);
    summary.author.username = alias;
  }

  private async handleGovernanceCommand(
    message: Message,
    summary: DiscordMessageSummary,
    command: DiscordAdminCommand
  ): Promise<DiscordCoreMindMessageResult> {
    if (!summary.guildId) {
      return this.governanceResult(summary, "这类管理命令只能在服务器频道里使用。", "guild command required");
    }

    if (command.type === "show_config") {
      if (!canManageDiscordBot({ ownerUserId: this.ownerUserId, config: this.discordConfig, message })) {
        return this.governanceResult(summary, "你没有权限查看这个服务器的 bot 配置。", "permission denied");
      }
      const managers = this.discordConfig.listManagers(summary.guildId);
      const activated = this.discordConfig.isChannelActivated(summary.channelId);
      const lines = [
        `本频道已${activated ? "启用" : "禁用"} bot 处理。`,
        `bot 所有者：${this.ownerUserId ? `<@${this.ownerUserId}>` : "未配置"}`,
        `本服 bot 管理者：${managers.length ? managers.map((id) => `<@${id}>`).join(" ") : "无"}`,
      ];
      return this.governanceResult(summary, lines.join("\n"), "showed governance config");
    }

    if (command.type === "manager_add" || command.type === "manager_remove") {
      if (!canEditManagers({ ownerUserId: this.ownerUserId, config: this.discordConfig, message })) {
        return this.governanceResult(summary, "只有 bot 所有者或本服管理员可以指定 bot 管理者。", "permission denied");
      }
      if (!command.targetUserId) {
        return this.governanceResult(summary, "请明确 @ 一位要设置的用户。", "missing target user");
      }
      const changed =
        command.type === "manager_add"
          ? this.discordConfig.addManager(summary.guildId, command.targetUserId)
          : this.discordConfig.removeManager(summary.guildId, command.targetUserId);
      const verb = command.type === "manager_add" ? "设为" : "移除";
      const suffix = changed ? "已更新配置。" : "配置没有变化。";
      return this.governanceResult(
        summary,
        `已将 <@${command.targetUserId}> ${verb} bot 管理者，${suffix}`,
        "updated guild managers"
      );
    }

    if (!canManageDiscordBot({ ownerUserId: this.ownerUserId, config: this.discordConfig, message })) {
      return this.governanceResult(
        summary,
        "只有 bot 所有者、本服 bot 管理者或管理员可以修改频道启用状态。",
        "permission denied"
      );
    }

    const activated = command.type === "channel_allow";
    this.discordConfig.setChannelActivated(summary.channelId, activated);
    return this.governanceResult(
      summary,
      `本频道现在已${activated ? "允许" : "停止"} bot 处理消息。`,
      "updated channel activation"
    );
  }

  private async sendGovernanceReply(channelId: string, messageId: string, content: string): Promise<ToolResult> {
    return this.sendStelleDiscordMessage({
      channel_id: channelId,
      content,
      reply_to_message_id: messageId,
    });
  }

  private noReply(reason: string, observed = true): DiscordCoreMindMessageResult {
    return { observed, replied: false, reason, route: "none" };
  }

  private messageResult(
    route: "cursor" | "stelle",
    reply: ToolResult,
    reason = reply.summary
  ): DiscordCoreMindMessageResult {
    return { observed: true, replied: reply.ok, reply, reason, route };
  }

  private async governanceResult(
    summary: DiscordMessageSummary,
    content: string,
    reason: string
  ): Promise<DiscordCoreMindMessageResult> {
    const reply = await this.sendGovernanceReply(summary.channelId, summary.id, content);
    await this.captureReplyMemory(reply, "governance", summary);
    return this.messageResult("stelle", reply, reason);
  }

  private async collectCursorDebugViews(): Promise<Record<string, unknown>[]> {
    return Promise.all(
      this.cursors.list().map(async (cursor) => ({
        identity: cursor.identity,
        state: cursor.getState(),
        tools: cursor.getToolNamespace(),
        observation: await this.tryAsync(() => cursor.observe()),
      }))
    );
  }

  private async tryAsync<T>(action: () => Promise<T>, fallback?: T): Promise<T | { error: string }> {
    try {
      return await action();
    } catch (error) {
      if (fallback !== undefined) return fallback;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export async function startDiscordAttachedCoreMind(options: DiscordAttachedCoreMindOptions = {}) {
  const app = new DiscordAttachedCoreMind(options);
  await app.start();
  return app;
}

function extractDiscordMessage(result: ToolResult): DiscordMessageSummary | null {
  const message = result.data?.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const candidate = message as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.channelId !== "string") return null;
  if (!candidate.author || typeof candidate.author !== "object") return null;
  return candidate as unknown as DiscordMessageSummary;
}
