import type {
  Message,
  TextBasedChannel,
  User,
} from "discord.js";
import type { AgentStatusUpdate } from "../../agent/types.js";
import type {
  ConversationReviewInput,
  ConversationReviewResult,
} from "../../stelle/memory/conversationReview.js";

const DEFAULT_MODEL = "gemma-4-31b-it";

export interface DiscordMemoryManager {
  guildId: string | null;
  dmUserId: string | null;
  loadContext(guildId: string | null, recallUid: string | null): Promise<string>;
  getHistoryEventsText(): Promise<string>;
  runReview(
    recentHistory: string[],
    reviewCount: number,
    source?: string
  ): Promise<boolean>;
  runDistill(eventText: string): Promise<void>;
}

export interface DiscordRuntimeDeps {
  getBotId(): string;
  estimateTokens(text: string): number;
  isLikelySpam(
    text: string,
    maxChars: number
  ): { spam: boolean; reason: string };
  sendLogEmbed(
    title: string,
    description?: string,
    color?: any,
    fields?: [string, string, boolean][]
  ): Promise<void>;
  sendLogDetailed(
    title: string,
    err: unknown,
    color?: any
  ): Promise<void>;
  formatMessage(
    msg: Message,
    nickname: string,
    lastAuthorId: string,
    lastMsgTime: number
  ): Promise<{ lines: string[]; authorId: string; ts: number }>;
  sendChunks(
    channel: TextBasedChannel,
    text: string,
    chunkSize?: number,
    asEmbed?: boolean
  ): Promise<Message[]>;
  getLlmConfig(
    guildId: string | null,
    userId?: string | null
  ): Record<string, unknown>;
  getLocalClient(guildId: string | null, userId?: string | null): any;
  parseJson(text: string): Record<string, unknown>;
  buildJudgePrompt(isDm: boolean): string;
  buildCharacterPrompt(isDm: boolean): string;
  runAgentLoop(options: any): Promise<{ text: string; toolTrace: any[] }>;
  buildToolAgentPrompt(): string;
  toolRegistry: unknown;
  truncateText(text: unknown, limit?: number): string;
  getChannelConfig(channelId: string): Record<string, unknown>;
  createMemoryManager(
    channelId: string,
    guildId: string | null,
    dmUserId: string | null
  ): DiscordMemoryManager;
  considerConversationReview(
    input: ConversationReviewInput
  ): Promise<ConversationReviewResult>;
  userIndex: {
    getName(guildId: string | null, userId: string): string;
    getOrCreateNickname(msg: Message): Promise<string>;
    buildMappingText(guildId: string | null, userIds: string[]): string;
  };
  createStatusReporter(input: {
    requester?: User | null;
    channel: TextBasedChannel;
  }): (update: AgentStatusUpdate) => Promise<void> | void;
  createAttachmentSender(input: {
    requester?: User | null;
    channel: TextBasedChannel;
  }): (filePath: string, caption?: string) => Promise<string | void> | string | void;
  synthesizeReplyAudio(input: {
    text: string;
    requester?: User | null;
    channel: TextBasedChannel;
  }): Promise<void>;
}

export interface DiscordChannelContext {
  channelId: string;
  guildId: string | null;
  dmUserId: string | null;
  history: string[];
  activeUsers: Map<string, number>;
  focus: string | null;
  intentSummary: string | null;
  waitCond: Record<string, unknown> | null;
  msgCount: number;
  lastMsgTime: number;
  lastAuthorId: string;
  isProcessing: boolean;
  shutUpUntil: number;
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
}

export interface DiscordChannelSnapshot {
  channelId: string;
  guildId: string | null;
  dmUserId: string | null;
  historySize: number;
  activeUserCount: number;
  focus: string | null;
  intentSummary: string | null;
  waitConditionType: string | null;
  waitExpiresAt: number | null;
  msgCount: number;
  lastMsgTime: number;
  lastAuthorId: string;
  isProcessing: boolean;
  shutUpUntil: number;
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
}

export class DiscordChannelSession {
  private static instances = new Map<string, DiscordChannelSession>();

  static get(
    channelId: string,
    deps: DiscordRuntimeDeps
  ): DiscordChannelSession {
    let instance = this.instances.get(channelId);
    if (!instance) {
      instance = new DiscordChannelSession(channelId, deps);
      this.instances.set(channelId, instance);
    }
    return instance;
  }

  static create(
    channelId: string,
    deps: DiscordRuntimeDeps
  ): DiscordChannelSession {
    return new DiscordChannelSession(channelId, deps);
  }

  static getExisting(channelId: string): DiscordChannelSession | null {
    return this.instances.get(channelId) ?? null;
  }

  static delete(channelId: string): boolean {
    const instance = this.instances.get(channelId);
    if (instance?.timerTask) {
      clearTimeout(instance.timerTask);
      instance.timerTask = null;
    }
    return this.instances.delete(channelId);
  }

  readonly history: string[] = [];
  readonly activeUsers = new Map<string, number>();
  focus: string | null = null;
  intentSummary: string | null = null;
  waitCond: Record<string, unknown> | null = null;
  msgCount = 0;
  lastMsgTime = Date.now() / 1000;
  timerTask: ReturnType<typeof setTimeout> | null = null;
  lastAuthorId = "0";
  isProcessing = false;
  shutUpUntil = 0;
  msgCountSinceReview = 0;
  reviewCountSinceDistill = 0;
  guildId: string | null = null;
  dmUserId: string | null = null;
  private mem: DiscordMemoryManager | null = null;

  private constructor(
    readonly channelId: string,
    private readonly deps: DiscordRuntimeDeps
  ) {}

  get context(): DiscordChannelContext {
    return {
      channelId: this.channelId,
      guildId: this.guildId,
      dmUserId: this.dmUserId,
      history: this.history,
      activeUsers: this.activeUsers,
      focus: this.focus,
      intentSummary: this.intentSummary,
      waitCond: this.waitCond,
      msgCount: this.msgCount,
      lastMsgTime: this.lastMsgTime,
      lastAuthorId: this.lastAuthorId,
      isProcessing: this.isProcessing,
      shutUpUntil: this.shutUpUntil,
      msgCountSinceReview: this.msgCountSinceReview,
      reviewCountSinceDistill: this.reviewCountSinceDistill,
    };
  }

  snapshot(): DiscordChannelSnapshot {
    return {
      channelId: this.channelId,
      guildId: this.guildId,
      dmUserId: this.dmUserId,
      historySize: this.history.length,
      activeUserCount: this.activeUsers.size,
      focus: this.focus,
      intentSummary: this.intentSummary,
      waitConditionType: this.waitCond
        ? String(this.waitCond.condition_type ?? "unknown")
        : null,
      waitExpiresAt: this.waitCond
        ? Number(this.waitCond.expiry ?? 0) || null
        : null,
      msgCount: this.msgCount,
      lastMsgTime: this.lastMsgTime,
      lastAuthorId: this.lastAuthorId,
      isProcessing: this.isProcessing,
      shutUpUntil: this.shutUpUntil,
      msgCountSinceReview: this.msgCountSinceReview,
      reviewCountSinceDistill: this.reviewCountSinceDistill,
    };
  }

  resetRuntimeState(): void {
    this.history.length = 0;
    this.activeUsers.clear();
    this.focus = null;
    this.intentSummary = null;
    this.waitCond = null;
    this.msgCount = 0;
    this.lastAuthorId = "0";
    this.isProcessing = false;
    this.shutUpUntil = 0;
    this.msgCountSinceReview = 0;
    this.reviewCountSinceDistill = 0;
    if (this.timerTask) {
      clearTimeout(this.timerTask);
      this.timerTask = null;
    }
  }

  muteFor(seconds: number): void {
    this.shutUpUntil = Date.now() / 1000 + seconds;
    this.waitCond = null;
    if (this.timerTask) {
      clearTimeout(this.timerTask);
      this.timerTask = null;
    }
  }

  get cfg(): Record<string, unknown> {
    return this.deps.getChannelConfig(this.channelId);
  }

  get memoryManager(): DiscordMemoryManager {
    if (!this.mem) {
      this.mem = this.deps.createMemoryManager(
        this.channelId,
        this.guildId,
        this.dmUserId
      );
    } else {
      this.mem.guildId = this.guildId;
      this.mem.dmUserId = this.dmUserId;
    }
    return this.mem;
  }

  trimHistoryByTokens(): void {
    let total = this.history.reduce(
      (sum, line) => sum + this.deps.estimateTokens(line),
      0
    );
    const maxT = Number(this.cfg.max_input_tokens_total ?? 8000);
    while (this.history.length && total > maxT) {
      const first = this.history.shift()!;
      total -= this.deps.estimateTokens(first);
    }
  }

  async parseMsg(msg: Message): Promise<boolean> {
    if (!this.guildId && msg.guildId) this.guildId = msg.guildId;
    if (!msg.guild && !this.dmUserId && !msg.author.bot) {
      this.dmUserId = msg.author.id;
    }

    const content = msg.cleanContent || "";
    const { spam, reason } = this.deps.isLikelySpam(
      content,
      Number(this.cfg.max_input_chars ?? 6000)
    );
    if (spam) {
      void this.deps.sendLogEmbed("馃洝锔?[AntiSpam] 鎷︽埅", "", 0x3498db, [
        ["鐢ㄦ埛", msg.author.id, false],
        ["鍘熷洜", reason, false],
      ]);
      return false;
    }

    this.activeUsers.set(msg.author.id, Date.now() / 1000);
    const nick =
      msg.author.id === this.deps.getBotId()
        ? "[Stelle]"
        : await this.deps.userIndex.getOrCreateNickname(msg);

    const { lines, authorId, ts } = await this.deps.formatMessage(
      msg,
      nick,
      this.lastAuthorId,
      this.lastMsgTime
    );
    this.lastAuthorId = authorId;
    this.lastMsgTime = ts;
    for (const line of lines) this.history.push(line);
    this.trimHistoryByTokens();
    this.trimHistoryByWindow();

    this.msgCount += 1;
    this.msgCountSinceReview += 1;
    return true;
  }

  updateIntentSummary(input: {
    focus: string | null;
    intent?: Record<string, unknown> | null;
  }): void {
    const stance = input.intent?.stance ? String(input.intent.stance) : "pass";
    const angle = input.intent?.angle ? String(input.intent.angle) : "";
    const focus = input.focus ?? this.focus ?? "none";
    this.intentSummary = angle
      ? `${stance}: ${angle} | focus=${focus}`
      : `${stance} | focus=${focus}`;
  }

  extractEmbedAndReply(raw: string): { reply: string; embed: string } {
    const cleaned = raw.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
    const embedMatch = cleaned.match(/<embed>(.*?)(?:<\/embed>|$)/is);
    const embedContent = embedMatch?.[1]?.trim() ?? "";
    const reply = cleaned.replace(/<embed>.*?(?:<\/embed>|$)/gis, "").trim();
    return { reply, embed: embedContent };
  }

  async callAi(
    mode: "judge" | "main",
    extra: { intent?: Record<string, unknown>; recall_user_id?: unknown } = {},
    runtime?: {
      onStatus?: (update: AgentStatusUpdate) => Promise<void> | void;
      sendDiscordAttachment?: (
        filePath: string,
        caption?: string
      ) => Promise<string | void> | string | void;
    }
  ): Promise<unknown> {
    const isDm = !this.guildId;
    const llmCfg = this.deps.getLlmConfig(this.guildId, this.dmUserId);
    const now = Date.now() / 1000;
    const activeUids = [...this.activeUsers.entries()]
      .filter(([uid, ts]) => now - ts < 600 && uid !== this.deps.getBotId())
      .map(([uid]) => uid);
    const participants =
      activeUids.map((u) => this.deps.userIndex.getName(this.guildId, u)).join(", ") ||
      "鏃?";
    const uidMap = this.deps.userIndex.buildMappingText(this.guildId, activeUids);
    const currUtc =
      new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const api = this.deps.getLocalClient(this.guildId, this.dmUserId);
    const model = String(llmCfg.model ?? DEFAULT_MODEL);

    try {
      if (mode === "judge") {
        const sysP =
          this.deps.buildJudgePrompt(isDm) +
          `\n[Time: ${currUtc}]\n[Mapping]\n${uidMap}`;
        const userMsg =
          `Active: ${participants}\nFocus: ${this.focus}\nHistory:\n` +
          this.history.slice(-10).join("\n");
        const resp = await api.chat.completions.create({
          model,
          messages: [
            { role: "system", content: sysP },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2048,
        });
        let judge = resp.choices[0]?.message?.content ?? "";
        judge = judge.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
        return this.deps.parseJson(judge);
      }

      const intent = (extra.intent ?? {}) as Record<string, unknown>;
      const recallRaw = extra.recall_user_id;
      const recallUid =
        recallRaw === null || recallRaw === undefined ? null : String(recallRaw);
      const memCtx = await this.memoryManager.loadContext(this.guildId, recallUid);
      const sysP =
        this.deps.buildCharacterPrompt(isDm) +
        `\n[Time: ${currUtc}]\nActive: ${participants}\n[Mapping]\n${uidMap}` +
        (memCtx ? `\n\nContext:\n${memCtx}` : "");
      const footer = `\n\nAngle: ${intent.angle}, Stance: ${intent.stance}`;
      const userMsg = "History:\n" + this.history.slice(-25).join("\n") + footer;

      const agentResult = await this.deps.runAgentLoop({
        client: api,
        model,
        registry: this.deps.toolRegistry,
        systemPrompt: `${sysP}\n\n${this.deps.buildToolAgentPrompt()}`,
        userPrompt: userMsg,
        context: {
          conversationId: this.channelId,
          cwd: process.cwd(),
          sendDiscordAttachment: runtime?.sendDiscordAttachment,
        },
        temperature: 0.7,
        maxTokens: 4096,
        onStatus: runtime?.onStatus,
      });
      const raw = agentResult.text.trim();
      const { reply, embed } = this.extractEmbedAndReply(raw);
      const fields: [string, string, boolean][] = [
        ["绉佽亰", String(isDm), true],
        ["杈撳叆", this.deps.truncateText(userMsg), false],
      ];
      if (embed) fields.push(["宓屽崱", this.deps.truncateText(embed), false]);
      await this.deps.sendLogEmbed("馃摑 MAIN 鏃ュ織", "", 0x3498db, fields);
      return [reply, embed] as const;
    } catch (e) {
      await this.deps.sendLogDetailed("鉂?API 寮傚父", e);
      return null;
    }
  }

  async executeReply(
    channel: TextBasedChannel,
    intent: Record<string, unknown>,
    recallUserId?: string | null,
    requester?: User | null
  ): Promise<void> {
    if (intent.stance === "pass" || this.isProcessing) return;
    if (!channel.isSendable()) return;
    this.isProcessing = true;
    this.waitCond = null;
    try {
      await channel.sendTyping().catch(() => {});
      const statusReporter = this.deps.createStatusReporter({
        requester: requester ?? null,
        channel,
      });
      const res = await this.callAi(
        "main",
        {
          intent,
          recall_user_id: recallUserId ?? null,
        },
        {
          onStatus: statusReporter,
          sendDiscordAttachment: this.deps.createAttachmentSender({
            requester: requester ?? null,
            channel,
          }),
        }
      );
      if (!res) {
        await channel.send({
          content: requester
            ? `<@${requester.id}> 我刚刚想回你，但上层模型调用失败或超时了。你可以看 debug 日志里的 API 异常；我这边不会再静默吞掉。`
            : "我刚刚想回复，但上层模型调用失败或超时了。你可以看 debug 日志里的 API 异常；我这边不会再静默吞掉。",
          allowedMentions: {
            users: requester ? [requester.id] : [],
            parse: [],
            repliedUser: false,
          },
        });
        return;
      }
      const [reply, embedContent] = res as [string, string];
      let replyText = reply;
      if (!replyText && embedContent) {
        replyText = "Detailed content in the card below:";
      }
      const toParse: Message[] = [];
      if (replyText) {
        toParse.push(...(await this.deps.sendChunks(channel, replyText, 2000, false)));
      }
      if (embedContent) {
        toParse.push(...(await this.deps.sendChunks(channel, embedContent, 4000, true)));
      }
      const speechText = replyText || embedContent.slice(0, 800);
      if (speechText) {
        await this.deps.synthesizeReplyAudio({
          text: speechText,
          requester: requester ?? null,
          channel,
        }).catch((error: unknown) => {
          void this.deps.sendLogDetailed("Discord TTS failed", error);
        });
      }
      for (const message of toParse) await this.parseMsg(message);
    } finally {
      this.isProcessing = false;
    }
  }

  maybeTriggerReview(): void {
    if (
      this.msgCountSinceReview >=
      Number(this.cfg.review_msg_threshold ?? 50)
    ) {
      void this.deps
        .considerConversationReview({
          memory: this.memoryManager,
          recentHistory: [...this.history],
          msgCountSinceReview: this.msgCountSinceReview,
          reviewCountSinceDistill: this.reviewCountSinceDistill,
          reviewMsgThreshold: Number(this.cfg.review_msg_threshold ?? 50),
          distillReviewThreshold: Number(this.cfg.distill_review_threshold ?? 5),
          source: "AUTO",
        })
        .then((result) => {
          this.msgCountSinceReview = result.msgCountSinceReview;
          this.reviewCountSinceDistill = result.reviewCountSinceDistill;
        });
    }
  }

  trimHistoryByWindow(): void {
    const maxLen = Math.max(4, Number(this.cfg.history_maxlen ?? 80));
    if (this.history.length > maxLen) {
      this.history.splice(0, this.history.length - maxLen);
    }
  }
}
