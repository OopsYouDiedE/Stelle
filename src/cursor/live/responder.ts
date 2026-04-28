import { splitSentences } from "../../utils/text.js";
import type { CursorContext } from "../types.js";
import type { LiveSpeechQueueItem } from "./types.js";
import type { OutputLane, OutputSalience } from "../../stage/output_types.js";

/**
 * 模块：Live Responder (队列与播放)
 */
export class LiveResponder {
  private readonly topicQueue: LiveSpeechQueueItem[] = [];
  private readonly responseQueue: LiveSpeechQueueItem[] = [];
  private readonly recentSpeech: string[] = [];

  constructor(private readonly context: CursorContext) {}

  /**
   * 将文本切割并压入相应的队列
   */
  public enqueue(target: "topic" | "response", text: string, emotion: string): void {
    const queue = target === "topic" ? this.topicQueue : this.responseQueue;
    const chunks = splitSentences(text).filter(s => s.trim().length > 0);
    
    for (const chunk of chunks) {
      queue.push({
        id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: chunk,
        source: target,
        enqueuedAt: this.context.now(),
        emotion: emotion
      });
    }

    const limit = this.context.config.live.speechQueueLimit || 5;
    if (queue.length > limit) queue.splice(0, queue.length - limit);
  }

  /**
   * 尝试从队列中获取下一个待播放项 (带 TTL 校验)
   */
  public dequeue(): LiveSpeechQueueItem | undefined {
    const now = this.context.now();
    
    // 优先响应弹幕
    while (this.responseQueue.length > 0) {
      const item = this.responseQueue.shift();
      if (item && now - item.enqueuedAt < 12000) return item; // 12s TTL
    }

    // 其次是主线话题
    return this.topicQueue.shift();
  }

  /**
   * 执行实际的舞台动作 (TTS/Caption/Expression)
   */
  public async play(item: LiveSpeechQueueItem): Promise<void> {
    const lane: OutputLane = item.source === "topic" ? "topic_hosting" : "live_chat";
    const salience: OutputSalience = item.source === "topic" ? "low" : "medium";
    const decision = await this.context.stageOutput.propose({
      id: item.id,
      cursorId: "live",
      lane,
      priority: item.source === "topic" ? 45 : 60,
      salience,
      text: item.text,
      summary: item.text,
      ttlMs: item.source === "topic" ? 30_000 : 12_000,
      interrupt: "none",
      output: {
        caption: true,
        tts: Boolean(this.context.config.live.ttsEnabled),
        expression: item.emotion !== "neutral" ? item.emotion : undefined,
      },
      metadata: {
        source: item.source,
        enqueuedAt: item.enqueuedAt,
      },
    });

    if (decision.status === "accepted" || decision.status === "interrupted") {
      this.recentSpeech.push(item.text);
      if (this.recentSpeech.length > 5) this.recentSpeech.shift();
    }
  }

  public getRecentSpeech(): string[] {
    return [...this.recentSpeech];
  }

  public getQueueStats() {
    return { topic: this.topicQueue.length, response: this.responseQueue.length };
  }
}
