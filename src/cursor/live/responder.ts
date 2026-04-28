import { splitSentences } from "../../utils/text.js";
import type { CursorContext } from "../types.js";
import type { LiveSpeechQueueItem } from "./types.js";
import type { OutputLane, OutputSalience } from "../../stage/output_types.js";

/**
 * 模块：Live Responder (队列与播放)
 */
export class LiveResponder {
  private readonly recentSpeech: string[] = [];

  constructor(private readonly context: CursorContext) {}

  /**
   * 将文本切割并发送到 StageOutputArbiter。
   * 采用并发发射策略，让 Arbiter 集中处理排队，避免 Responder 被长渲染阻塞。
   */
  public async enqueue(target: "topic" | "response", text: string, emotion: string): Promise<void> {
    const chunks = splitSentences(text).filter(s => s.trim().length > 0);
    
    // 并发提交所有 chunk，让 Arbiter 的统一队列发挥作用
    await Promise.all(chunks.map(chunk => this.proposeChunk(target, chunk, emotion)));
  }

  private async proposeChunk(target: "topic" | "response", text: string, emotion: string): Promise<void> {
    // 响应弹幕使用 direct_response，以便在舞台繁忙时能排在话题托管前面
    const lane: OutputLane = target === "response" ? "direct_response" : "topic_hosting";
    const salience: OutputSalience = target === "response" ? "medium" : "low";
    
    const decision = await this.context.stageOutput.propose({
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cursorId: "live",
      lane,
      priority: target === "response" ? 60 : 45,
      salience,
      text: text,
      summary: text,
      ttlMs: target === "response" ? 15_000 : 30_000,
      interrupt: target === "response" ? "soft" : "none",
      output: {
        caption: true,
        tts: Boolean(this.context.config.live.ttsEnabled),
        expression: emotion !== "neutral" ? emotion : undefined,
      },
      metadata: {
        source: target,
      },
    });

    if (decision.status === "accepted" || decision.status === "interrupted" || decision.status === "queued") {
      this.recentSpeech.push(text);
      if (this.recentSpeech.length > 5) this.recentSpeech.shift();
    }
  }

  public getRecentSpeech(): string[] {
    return [...this.recentSpeech];
  }

  public getQueueStats() {
    return { topic: 0, response: 0 }; // Queues are now in StageOutputArbiter
  }
}
