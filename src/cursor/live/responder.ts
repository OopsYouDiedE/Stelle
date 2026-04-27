import { splitSentences, sanitizeExternalText } from "../../utils/text.js";
import type { CursorContext } from "../types.js";
import type { LiveSpeechQueueItem } from "./types.js";

/**
 * 模块：Live Responder (队列与播放)
 */
export class LiveResponder {
  private readonly topicQueue: LiveSpeechQueueItem[] = [];
  private readonly responseQueue: LiveSpeechQueueItem[] = [];
  private readonly recentSpeech: string[] = [];

  constructor(private readonly context: CursorContext, private readonly tools: string[]) {}

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
    const toolContext = { caller: "cursor" as const, cursorId: "live", cwd: process.cwd(), allowedAuthority: ["external_write" as const], allowedTools: this.tools };

    // 1. 同步情绪
    if (item.emotion !== "neutral") {
      await this.context.tools.execute("live.set_expression", { expression: item.emotion }, toolContext).catch(() => {});
    }

    // 2. 播报
    if (this.context.config.live.ttsEnabled) {
      await this.context.tools.execute("live.stream_tts_caption", { text: item.text, emotion: item.emotion }, toolContext);
    } else {
      await this.context.tools.execute("live.stream_caption", { text: item.text, speaker: "Stelle" }, toolContext);
    }

    this.recentSpeech.push(item.text);
    if (this.recentSpeech.length > 5) this.recentSpeech.shift();
  }

  public getRecentSpeech(): string[] {
    return [...this.recentSpeech];
  }

  public getQueueStats() {
    return { topic: this.topicQueue.length, response: this.responseQueue.length };
  }
}
