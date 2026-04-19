import { ChannelType, type Message, type Typing } from "discord.js";
import { EventDrivenDiscordCursor } from "./DiscordCursor.js";
import {
  DiscordChannelSession,
  type DiscordRuntimeDeps,
} from "./runtime.js";

function keywordList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
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
    session.reviewCountSinceDistill += 1;
    const ok = await session.memoryManager.runReview(
      [...session.history],
      session.reviewCountSinceDistill,
      "MANUAL"
    );
    if (ok) {
      session.msgCountSinceReview = 0;
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
    const isMentioned = botId !== "0" ? message.mentions.has(botId) : false;

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

    if (isMentioned || isDm) {
      await session.executeReply(
        message.channel,
        {
          stance: "react",
          angle: "直接回应",
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
      const judge = (await session.callAi("judge")) as Record<string, unknown> | null;
      if (judge) {
        const focus = judge.focus as Record<string, unknown> | undefined;
        session.focus = (focus?.topic as string) ?? "无";
        const trigger = (judge.trigger as Record<string, unknown>) ?? {};
        session.waitCond = {
          ...trigger,
          intent: (judge.intent as Record<string, unknown>) ?? { stance: "pass" },
          recall_user_id: judge.recall_user_id,
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
      await session.executeReply(
        message.channel,
        intent,
        recallUserId,
        message.author
      );
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
      await session.executeReply(
        message.channel,
        intent,
        recallUserId,
        message.author
      );
      return;
    }

    if (type === "keyword") {
      const keywords = keywordList(condition.condition_value);
      if (keywords.some((keyword) => message.content.includes(keyword))) {
        await session.executeReply(
          message.channel,
          intent,
          recallUserId,
          message.author
        );
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
