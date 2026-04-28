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
   * 将文本切割并发送到 StageOutputArbiter
   */
  public async enqueue(target: "topic" | "response", text: string, emotion: string): Promise<void> {
    const chunks = splitSentences(text).filter(s => s.trim().length > 0);
    
    for (const chunk of chunks) {
      await this.proposeChunk(target, chunk, emotion);
    }
  }

  private async proposeChunk(target: "topic" | "response", text: string, emotion: string): Promise<void> {
    // 调整 Lane 优先级：live_chat (响应) 应该高于 topic_hosting (主线)
    // 根据 src/stage/output_policy.ts: 
    // topic_hosting: 500, live_chat: 400. 
    // Wait, LANE_RANK says topic_hosting is higher.
    // If I want to prefer responses, I should maybe use direct_response or adjust topic_hosting.
    // Actually, LiveResponder's target="response" is for danmaku responses.
    
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

    if (decision.status === "accepted" || decision.status === "interrupted") {
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
