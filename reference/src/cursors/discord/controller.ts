import { ChannelType, type Message, type Typing } from "discord.js";
import { EventDrivenDiscordCursor } from "./DiscordCursor.js";
import {
  DiscordChannelSession,
  type DiscordRuntimeDeps,
} from "./runtime.js";
import { judgeDiscordTurn } from "./judge.js";

function keywordList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

function isStelleNameMentioned(text: string): boolean {
  return /(?:^|[\s<@])@?Stelle(?:$|[\s>?!?,，。:：])/i.test(text);
}

function isMinecraftCrossCursorRequest(text: string): boolean {
  return /minecraft|mc|服务器|局域网|局域联机|钻石|diamond|铁|iron/i.test(text) &&
    /指令|命令|command|输入|敲|执行|挖|采|弄|找|帮我|可以吗|mine|collect|get/i.test(text);
}

export class DiscordCursorController {
  readonly cursor: EventDrivenDiscordCursor;
  private readonly typingStates = new Map<string, Map<string, number>>();

  constructor(private readonly deps: DiscordRuntimeDeps) {
    this.cursor = new EventDrivenDiscordCursor({
      id: "discord-main",
      onMessage: this.processMessage.bind(this),
      onTypingStart: this.processTypingStart.bind(this),
      getChannelSnapshot: (channelId) => {
        const cfg = this.deps.getChannelConfig(channelId);
        if (cfg.activated !== true) return null;
        return this.ensurePersistentSession(channelId).snapshot();
      },
    });
  }

  bootstrapActivatedChannels(channelIds: string[]): void {
    for (const channelId of channelIds) {
      const cfg = this.deps.getChannelConfig(channelId);
      if (cfg.activated === true) {
        this.ensurePersistentSession(channelId);
      }
    }
  }

  cleanupTypingStates(): void {
    const now = Date.now() / 1000;
    for (const [channelId, state] of this.typingStates) {
      for (const [userId, ts] of state) {
        if (now - ts >= 30) state.delete(userId);
      }
      if (!state.size) this.typingStates.delete(channelId);
    }
  }

  ensurePersistentSession(channelId: string): DiscordChannelSession {
    return DiscordChannelSession.get(channelId, this.deps);
  }

  getExistingSession(channelId: string): DiscordChannelSession | null {
    return DiscordChannelSession.getExisting(channelId);
  }

  deactivateChannel(channelId: string): boolean {
    return DiscordChannelSession.delete(channelId);
  }

  muteChannel(channelId: string, seconds: number): boolean {
    const session = this.getExistingSession(channelId);
    if (!session) return false;
    session.muteFor(seconds);
    return true;
  }

  clearChannelRuntime(channelId: string): boolean {
    const session = this.getExistingSession(channelId);
    if (!session) return false;
    session.resetRuntimeState();
    return true;
  }

  async runManualReview(
    channelId: string
  ): Promise<"missing" | "empty" | "success" | "failed"> {
    const session = this.getExistingSession(channelId);
    if (!session) return "missing";
    if (!session.history.length) return "empty";
    const result = await this.deps.considerConversationReview({
      memory: session.memoryManager,
      recentHistory: [...session.history],
      msgCountSinceReview: Number(session.cfg.review_msg_threshold ?? 50),
      reviewCountSinceDistill: session.reviewCountSinceDistill,
      reviewMsgThreshold: Number(session.cfg.review_msg_threshold ?? 50),
      distillReviewThreshold: Number(session.cfg.distill_review_threshold ?? 5),
      source: "MANUAL",
    });
    if (result.reviewSucceeded) {
      session.msgCountSinceReview = result.msgCountSinceReview;
      session.reviewCountSinceDistill = result.reviewCountSinceDistill;
      return "success";
    }
    return "failed";
  }

  async startDistill(
    channelId: string
  ): Promise<"missing" | "empty" | "started"> {
    const session = this.getExistingSession(channelId);
    if (!session) return "missing";
    const eventText = (await session.memoryManager.getHistoryEventsText()).trim();
    if (!eventText) return "empty";
    void session.memoryManager.runDistill(eventText);
    return "started";
  }

  async importHistoryBatch(
    channelId: string,
    lines: string[],
    source: string
  ): Promise<boolean> {
    const session = this.ensurePersistentSession(channelId);
    return session.memoryManager.runReview(lines, 0, source);
  }

  async debugMessage(
    channelId: string,
    text: string,
    options?: {
      authorId?: string;
      nickname?: string;
      runMain?: boolean;
    }
  ): Promise<Record<string, unknown>> {
    const session = this.ensurePersistentSession(channelId);
    const ts = Date.now() / 1000;
    const authorId = options?.authorId ?? "debug-user";
    const nickname = options?.nickname ?? "[DebugUser]";
    const line = `${nickname}: ${text}`;

    session.activeUsers.set(authorId, ts);
    session.lastAuthorId = authorId;
    session.lastMsgTime = ts;
    session.history.push(line);
    session.trimHistoryByTokens();
    session.trimHistoryByWindow();
    session.msgCount += 1;
    session.msgCountSinceReview += 1;

    const judge = await judgeDiscordTurn(session);
    if (!judge) {
      return {
        ok: false,
        summary: "Discord judge returned null.",
        historyTail: session.history.slice(-12),
      };
    }

    session.focus = judge.focus ?? session.focus;
    session.updateIntentSummary({
      focus: judge.focus ?? session.focus,
      intent: judge.intent,
    });
    session.waitCond = {
      ...judge.trigger,
      intent: judge.intent,
      recall_user_id: judge.recallUserId,
      expiry: ts + Number(judge.trigger.expires_after ?? 120),
    };

    let main: unknown = null;
    if (options?.runMain !== false && judge.intent.stance !== "pass") {
      main = await session.callAi("main", {
        intent: judge.intent,
        recall_user_id: judge.recallUserId,
      });
    }

    return {
      ok: true,
      summary: "Debug message processed by Discord cursor session.",
      judge,
      main,
      historyTail: session.history.slice(-12),
      snapshot: session.snapshot(),
    };
  }

  private async processTypingStart(typing: Typing): Promise<void> {
    if (typing.user?.bot) return;
    const userId = typing.user?.id;
    const channel = typing.channel;
    if (!userId || !channel) return;
    const state = this.typingStates.get(channel.id) ?? new Map<string, number>();
    state.set(userId, Date.now() / 1000);
    this.typingStates.set(channel.id, state);
  }

  private async processMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    const channelId = message.channel.id;
    const isDm = message.channel.type === ChannelType.DM;
    const botId = this.deps.getBotId();
    const content = message.cleanContent || message.content || "";
    const isMentioned =
      (botId !== "0" ? message.mentions.has(botId) : false) ||
      isStelleNameMentioned(content);

    const cfg = this.deps.getChannelConfig(channelId);
    const isActive = cfg.activated === true;
    if (!isActive && !isDm && !isMentioned) return;

    const session = isActive
      ? this.ensurePersistentSession(channelId)
      : DiscordChannelSession.create(channelId, this.deps);

    if (!(await session.parseMsg(message))) return;
    if (isActive) session.maybeTriggerReview();
    if (session.isProcessing) return;

    const now = Date.now() / 1000;
    if (now < session.shutUpUntil) return;

    if ((isMentioned || isDm) && isMinecraftCrossCursorRequest(message.content)) {
      session.updateIntentSummary({
        focus: "minecraft cross-cursor request",
        intent: {
          stance: "inform",
          angle: "Let Stelle route the Discord request through Minecraft before answering.",
        },
      });
      if (message.channel.isSendable()) {
        await message.reply({
          content: "我收到。现在把这个请求交给 Stelle 的 Minecraft 窗口去试，执行结果会回到这里。",
          allowedMentions: {
            users: [message.author.id],
            parse: [],
            repliedUser: true,
          },
        });
      }
      return;
    }

    if (isMentioned || isDm) {
      session.updateIntentSummary({
        focus: session.focus,
        intent: {
          stance: "react",
          angle: "Direct response",
        },
      });
      await session.executeReply(
        message.channel,
        {
          stance: "react",
          angle: "Direct response",
        },
        undefined,
        message.author
      );
      return;
    }

    if (!isActive) return;

    if (session.timerTask) {
      clearTimeout(session.timerTask);
      session.timerTask = null;
    }

    if (!session.waitCond) {
      const judge = await judgeDiscordTurn(session);
      if (judge) {
        session.focus = judge.focus ?? "none";
        const trigger = judge.trigger;
        session.updateIntentSummary({
          focus: session.focus,
          intent: judge.intent,
        });
        session.waitCond = {
          ...trigger,
          intent: judge.intent ?? { stance: "pass" },
          recall_user_id: judge.recallUserId,
          expiry: now + Number(trigger.expires_after ?? 120),
        };
        session.msgCount = 0;
      }
    }

    if (!session.waitCond) return;

    const condition = session.waitCond;
    if (now > Number(condition.expiry ?? 0)) {
      session.waitCond = null;
      return;
    }

    const type = String(condition.condition_type ?? "");
    const recallUserId =
      condition.recall_user_id === null || condition.recall_user_id === undefined
        ? null
        : String(condition.recall_user_id);
    const intent = condition.intent as Record<string, unknown>;
    const noTyping = !this.isSomeoneTyping(channelId);

    if (condition.fire_now === true && noTyping) {
      await session.executeReply(message.channel, intent, recallUserId, message.author);
      return;
    }

    if (type === "silence" && noTyping) {
      const seconds = Number(condition.condition_value ?? 15);
      session.timerTask = setTimeout(() => {
        session.timerTask = null;
        void (async () => {
          const current = Date.now() / 1000;
          if (
            !session.isProcessing &&
            current >= session.shutUpUntil &&
            message.channel.isTextBased()
          ) {
            await session.executeReply(
              message.channel,
              intent,
              recallUserId,
              message.author
            );
          }
        })();
      }, seconds * 1000);
      return;
    }

    if (type === "gap" && session.msgCount >= Number(condition.condition_value ?? 5)) {
      await session.executeReply(message.channel, intent, recallUserId, message.author);
      return;
    }

    if (type === "keyword") {
      const keywords = keywordList(condition.condition_value);
      if (keywords.some((keyword) => message.content.includes(keyword))) {
        await session.executeReply(message.channel, intent, recallUserId, message.author);
      }
    }
  }

  private isSomeoneTyping(channelId: string): boolean {
    const now = Date.now() / 1000;
    const state = this.typingStates.get(channelId);
    if (!state) return false;
    return [...state.values()].some((timestamp) => now - timestamp < 6);
  }
}
