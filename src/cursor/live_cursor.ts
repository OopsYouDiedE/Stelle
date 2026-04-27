/**
 * Module: Live Cursor (V2 - Active Broadcast Engine)
 *
 * 核心架构升级:
 * 1. 异步非阻塞 Tick: Tick 循环只负责消费队列和推送动作，绝不 await LLM，彻底杜绝直播卡顿。
 * 2. 弹幕批处理 (Batch Awareness): 收集时间窗口内的弹幕流，让 AI 感知“群体氛围”而非单点回复。
 * 3. 情绪惯性与短时记忆 (Emotional Inertia): 注入 AI 近期发言缓存，保持人设一致性和表情平滑度。
 * 4. 单步高能生成 (Single-Pass Generation): 将路由、决策和脚本生成合并为单次 LLM 请求，大幅降低延迟。
 */

import type { ToolContext } from "../tool.js";
import { asRecord, enumValue } from "../utils/json.js";
import { moderateLiveEvent, normalizeLiveEvent, type NormalizedLiveEvent } from "../utils/live_event.js";
import { sanitizeExternalText, splitSentences, truncateText } from "../utils/text.js";
import type { CursorContext, CursorSnapshot, StelleEvent, StelleCursor } from "./types.js";

export const LIVE_PERSONA = `
You are Stelle's Live Cursor (VTuber/Streamer AI).
You manage the vibe of the stream. You speak naturally, briefly, and with emotional intelligence.
Do not act like a robotic assistant. Acknowledge the crowd, play along with jokes, and keep the stream moving.
`;

// 统一的生成决策大一统模型 (Single-Pass Schema)
interface LiveBatchDecision {
  action: "respond_to_crowd" | "respond_to_specific" | "drop_noise" | "generate_topic";
  emotion: "neutral" | "happy" | "laughing" | "sad" | "surprised" | "thinking" | "teasing";
  intensity: number; // 1-5
  script: string;    // 生成的台词 (如果 drop 则为空)
  reason: string;
}

interface LiveSpeechQueueItem {
  id: string;
  text: string;
  source: "topic" | "response";
  enqueuedAt: number;
  emotion: string;
}

export interface LiveRequestResult {
  accepted: boolean;
  ok: boolean;
  reason: string;
  summary: string;
  stageActions: string[];
}

const LIVE_CURSOR_TOOLS = [
  "basic.datetime",
  "memory.read_long_term",
  "memory.write_recent",
  "memory.search",
  "search.web_search",
  "search.web_read",
  "live.status",
  "live.get_stage",
  "live.set_caption",
  "live.stream_caption",
  "live.show_route_decision",
  "live.push_event",
  "live.stream_tts_caption",
  "live.trigger_motion",
  "live.set_expression",
  "live.set_background",
  "obs.status",
] as const;

export class LiveCursor implements StelleCursor {
  readonly id = "live";
  readonly kind = "live";
  readonly displayName = "Live Cursor";

  private status: CursorSnapshot["status"] = "idle";
  private summary = "Live stream engine online.";

  // 双轨队列与 TTL 机制
  private readonly topicQueue: LiveSpeechQueueItem[] = [];
  private readonly responseQueue: LiveSpeechQueueItem[] = [];
  private nextThemeAt = 0;
  // 批处理与防抖缓冲池
  private eventBuffer: NormalizedLiveEvent[] = [];
  private bufferTimer?: NodeJS.Timeout | null;
  
  // 认知与情绪状态机
  private readonly recentSpeech: string[] = []; // 最近自己说过的 5 句话
  private currentEmotion = "neutral";
  private isGenerating = false; // 防止并发生成洪水
  private tickInFlight = false;

  constructor(private readonly context: CursorContext) {}

  async initialize(): Promise<void> {
    this.context.publishEvent({ type: "live.tick", reason: "init_dummy_event" } as any); // just for type check bypassing
    import("../utils/event_bus.js").then(({ eventBus }) => {
       eventBus.subscribe("live.tick", () => {
         void this.tick().catch(e => console.error("[LiveCursor] Tick error:", e));
       });
       eventBus.subscribe("live.request", (event: any) => {
         void this.receiveDispatch(event).catch(e => console.error("[LiveCursor] Dispatch error:", e));
       });
    });
  }

  async receiveDispatch(event: StelleEvent): Promise<{ accepted: boolean; reason: string; eventId: string }> {
    if (event.type !== "live.request") {
      return { accepted: false, reason: "Unhandled live command", eventId: event.id ?? `evt-${Date.now()}` };
    }
    const payload = event.payload;
    const text = sanitizeExternalText(payload.text);
    
    // 外部强制下发的直接进入话题队列 (如游戏关键剧情点)
    if (payload.forceTopic && text) {
      this.enqueueSequence("topic", text, "neutral");
    } else if (text) {
      this.enqueueSequence("response", text, "neutral");
      await this.pushSystemEvent(event.id ?? `live-request-${Date.now()}`, "response", text);
    }
    
    if (text) {
      await this.reportReflection("dispatch_response", truncateText(text, 240), 8, "high");
    }

    this.summary = text ? `[Live:Dispatch] ${truncateText(text, 100)}` : "Live command accepted.";
    return { accepted: true, reason: "Dispatched to live engine", eventId: event.id ?? `evt-${Date.now()}` };
  }

  /**
   * Layer 1: 感知与收集层 (Buffer & Vibe Sniffing)
   * 立即返回，绝不阻塞。负责过滤脏数据，并将有效弹幕压入滑动窗口缓冲池。
   */
  async receiveLiveEvent(payload: Record<string, unknown>) {
    const event = normalizeLiveEvent(payload);
    const moderation = moderateLiveEvent(event);
    
    if (!moderation.allowed) {
      await this.pushSystemEvent(event.id, "dropped", moderation.reason);
      return { accepted: true, ok: true, reason: moderation.reason, summary: "Dropped", stageActions: [] };
    }

    // 基础防刷屏：纯数字、短节奏模式直接丢弃 (降低算力压力)
    if (/^[0-9+]+$|^扣|^签到/u.test(event.text.trim()) && event.priority !== "high") {
      return { accepted: true, ok: true, reason: "Gameplay noise", summary: "Filtered", stageActions: [] };
    }

    // 压入缓冲池
    this.eventBuffer.push(event);
    await this.pushSystemEvent(event.id, "incoming", event.text);

    // 高优事件（打赏/SC）立即触发评估，普通事件使用滑动窗口 (2000ms)
    const debounceMs = event.priority === "high" ? 100 : 2000;
    
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.processEventBuffer(), debounceMs);

    return { accepted: true, ok: true, reason: "Buffered", summary: "Buffered", stageActions: [] };
  }

  /**
   * Layer 2: 单次批处理评估与生成 (Single-Pass LLM RAG)
   * 独立于 Tick 运行在后台，负责分析弹幕氛围并生成台词。
   */
  private async processEventBuffer() {
    if (this.isGenerating || this.eventBuffer.length === 0) return;
    this.isGenerating = true;

    try {
      const batch = [...this.eventBuffer];
      this.eventBuffer = []; // 清空池子迎接新弹幕
      
      const decision = await this.evaluateBatch(batch);
      
      if (decision.action === "drop_noise" || !decision.script.trim()) {
        this.summary = `[Live:Drop] ${decision.reason}`;
        return;
      }

      this.summary = `[Live:${decision.action}] ${truncateText(decision.script, 100)}`;
      this.currentEmotion = decision.emotion; // 状态机情绪更新
      
      // 切割长文本，压入回复队列，并标记 TTL
      this.enqueueSequence("response", decision.script, decision.emotion);
      
      // 评估反思压力
      const impactScore = decision.action === "respond_to_specific" ? 4 : 2;
      const salience = decision.action === "respond_to_specific" ? "medium" : "low";
      await this.reportReflection(decision.action, truncateText(decision.script, 240), impactScore, salience);

      // 如果有强力回应，将主线任务(Topic)推迟，实现 Interrupt 机制
      this.nextThemeAt = this.context.now() + 5000; 
      
    } finally {
      this.isGenerating = false;
      // 如果处理期间又有新弹幕积压，且不是空闲，继续处理
      if (this.eventBuffer.length > 0) {
        this.bufferTimer = setTimeout(() => this.processEventBuffer(), 1000);
      }
    }
  }

  /**
   * Layer 3: 播放心跳引擎 (The Non-blocking Game Loop)
   * 由外部或定时器高频调用 (如每秒 2 次)。只负责出队播放和 TTL 管理，无 LLM 阻塞。
   */
  async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    const now = this.context.now();

    try {
      // 1. 防冷场补给 (Topic Hunger Management)
      if (this.responseQueue.length === 0 && this.topicQueue.length === 0 && now >= this.nextThemeAt) {
        if (!this.isGenerating) {
          // 异步触发闲聊生成，绝不使用 await 阻塞 tick
          this.generateIdleTopic().catch(e => console.warn("Topic gen failed", e));
          this.nextThemeAt = now + 15000; // 防止重复触发，先往后推 15 秒
        }
      }

      // 2. 双轨出队与 TTL (Time-To-Live) 过期丢弃
      let next: LiveSpeechQueueItem | undefined;
      while (this.responseQueue.length > 0) {
        const item = this.responseQueue.shift();
        if (item && now - item.enqueuedAt < 12000) { // 超过 12 秒的响应直接丢弃，保证直播当下感
          next = item;
          break;
        } else {
          console.log(`[Live] Dropped stale response: ${item?.text}`);
        }
      }

      // 如果没有弹幕回应，则消费主线闲聊
      if (!next) next = this.topicQueue.shift();
      if (!next) return; // 真的没有话要说

      // 3. 执行动作与语音流 (State Execution)
      await this.playItem(next);

      // 4. 计算阻塞时间与记忆存储
      const durationMs = Math.max(2500, next.text.length * 200);
      this.nextThemeAt = now + durationMs + 1000; // 下一句话的自然间隔
      this.recordSpeechMemory(next.text);

    } finally {
      this.tickInFlight = false;
    }
  }

  // --- 核心认知与生成引擎 ---

  private async evaluateBatch(batch: NormalizedLiveEvent[]): Promise<LiveBatchDecision> {
    if (!this.context.config.models.apiKey) {
      return { action: "drop_noise", emotion: "neutral", intensity: 1, script: "", reason: "No API key" };
    }

    const batchLog = batch.map(e => `[${e.priority}] ${e.user?.name ?? "观众"}: ${e.text}`).join("\n");
    const recentContext = this.recentSpeech.join("\n");
    const focus = await this.context.memory?.readLongTerm("current_focus").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious").catch(() => null);

    const prompt = [
      LIVE_PERSONA,
      subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
      "You are the Live Director and Actor in one. Read the recent chat messages.",
      "1. Analyze the VIBE. Is it a crowd reaction (many laughing), or a specific high-value question?",
      "2. Respond naturally. If it's low-value noise, use action 'drop_noise'.",
      "3. NEVER repeat what you just said.",
      `Current Focus / Game State:\n${focus ?? "Just chatting with chat"}`,
      `What you just said (DO NOT REPEAT):\n${recentContext || "(Silent)"}`,
      `Current Emotion: ${this.currentEmotion}`,
      `\nLATEST CHAT BATCH:\n${batchLog}`
    ].filter((item): item is string => Boolean(item)).join("\n\n");

    try {
      return await this.context.llm.generateJson(
        prompt,
        "live_batch_decision",
        (raw) => {
          const v = asRecord(raw);
          return {
            action: enumValue(v.action, ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const, "drop_noise"),
            emotion: enumValue(v.emotion, ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const, "neutral"),
            intensity: typeof v.intensity === "number" ? v.intensity : 3,
            script: sanitizeExternalText(String(v.script || "")),
            reason: String(v.reason || "auto")
          };
        },
        { role: "primary", temperature: 0.65, maxOutputTokens: 300 } // 温度适中，保证灵动
      );
    } catch {
      return { action: "drop_noise", emotion: "neutral", intensity: 1, script: "", reason: "Error" };
    }
  }

  private async generateIdleTopic(): Promise<void> {
    this.isGenerating = true;
    try {
      const focus = await this.context.memory?.readLongTerm("current_focus").catch(() => null);
      const subconscious = await this.context.memory?.readLongTerm("global_subconscious").catch(() => null);
      const recentContext = this.recentSpeech.join("\n");
      
      const text = await this.context.llm.generateText(
        [
          LIVE_PERSONA,
          subconscious ? `Internal subconscious guidance:\n${subconscious}` : undefined,
          "Chat is quiet. Generate ONE short, engaging sentence to keep the stream lively based on the current focus.",
          "It can be a random thought, a question to chat, or a comment on the game.",
          `Current Focus:\n${focus ?? "Relaxed chatting"}`,
          `What you just said:\n${recentContext || "(none)"}`
        ].filter((item): item is string => Boolean(item)).join("\n\n"),
        { role: "secondary", temperature: 0.8, maxOutputTokens: 150 } // 高温度，激发创造力
      );

      if (text) {
        this.enqueueSequence("topic", text, this.currentEmotion);
        await this.reportReflection("idle_topic", truncateText(text, 240), 1, "low");
      }
    } finally {
      this.isGenerating = false;
    }
  }

  // --- 辅助队列与硬件工具控制 ---

  private async playItem(item: LiveSpeechQueueItem) {
    // 1. 同步情绪到视觉层 (Visuals)
    if (item.emotion !== "neutral") {
      await this.context.tools.execute("live.set_expression", { expression: item.emotion }, this.toolContext(["external_write"])).catch(() => {});
    }

    // 2. 同步台词到听觉与字幕层 (Audio & Text)
    if (this.context.config.live.ttsEnabled) {
      // 优化点：可以在此处将 item.emotion 传给高级 TTS API 实现带情感语气的生成
      await this.context.tools.execute("live.stream_tts_caption", { text: item.text, emotion: item.emotion }, this.toolContext(["external_write"]));
    } else {
      await this.context.tools.execute("live.stream_caption", { text: item.text, speaker: "Stelle" }, this.toolContext(["external_write"]));
    }
  }

  private enqueueSequence(target: "topic" | "response", text: string, emotion: string) {
    const queue = target === "topic" ? this.topicQueue : this.responseQueue;
    const chunks = splitSentences(text).filter(s => s.trim().length > 0);
    
    // 限制队列长度防止无限堆叠
    if (queue.length > 5) queue.length = 5; 

    for (const chunk of chunks) {
      queue.push({
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: chunk,
        source: target,
        enqueuedAt: this.context.now(),
        emotion: emotion
      });
    }
  }

  private recordSpeechMemory(text: string) {
    this.recentSpeech.push(text);
    if (this.recentSpeech.length > 4) this.recentSpeech.shift(); // 始终保持只记住最近的 4 句话
  }

  private async pushSystemEvent(id: string, lane: string, text: string) {
    await this.context.tools.execute(
      "live.push_event",
      { event_id: id, lane, text },
      this.toolContext(["external_write"])
    ).catch(() => {}); // fire and forget
  }

  private async reportReflection(intent: string, summary: string, impactScore = 1, salience: "low" | "medium" | "high" = "low"): Promise<void> {
    this.context.publishEvent({
      type: "cursor.reflection",
      source: "live",
      payload: { intent, summary, impactScore, salience },
    });
  }

  private toolContext(allowedAuthority: ToolContext["allowedAuthority"]): ToolContext {
    return { caller: "cursor", cursorId: this.id, cwd: process.cwd(), allowedAuthority, allowedTools: [...LIVE_CURSOR_TOOLS] };
  }

  snapshot(): CursorSnapshot {
    return {
      id: this.id, kind: this.kind, status: this.status, summary: this.summary,
      state: {
        bufferSize: this.eventBuffer.length,
        topicQueue: this.topicQueue.length,
        responseQueue: this.responseQueue.length,
        currentEmotion: this.currentEmotion
      }
    };
  }
}
