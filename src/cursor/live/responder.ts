// === Imports ===
import { splitSentences } from "../../utils/text.js";
import type { CursorContext } from "../types.js";
import type { OutputLane, OutputSalience, StageOutputDecision } from "../../stage/output_types.js";
import { ProposalPriority } from "./types.js";

// === Interfaces ===
export interface LiveEnqueueOptions {
  groupId?: string;
  sequenceStart?: number;
  sourceEventId?: string;
  metadata?: Record<string, any>;
  priority?: number;
}

/**
 * 模块：Live Responder (队列与播放)
 */
// === Class Definition ===
export class LiveResponder {
  private readonly recentSpeech: string[] = [];

  constructor(
    private readonly context: CursorContext,
    private readonly cursorId = "live_danmaku",
  ) {}

  // === Enqueue & Proposal Logic ===
  /**
   * 将文本切割并发送到 StageOutputArbiter。
   * 按句顺序提交给 Arbiter，避免字幕/TTS 片段在舞台资源仲裁前乱序。
   */
  public async enqueue(
    target: "topic" | "response",
    text: string,
    emotion: string,
    options: LiveEnqueueOptions = {},
  ): Promise<StageOutputDecision[]> {
    const chunks = splitSentences(text).filter((s) => s.trim().length > 0);
    const groupId = options.groupId ?? `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const decisions: StageOutputDecision[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      decisions.push(
        await this.proposeChunk(target, chunks[index], emotion, {
          groupId,
          sequence: (options.sequenceStart ?? 0) + index,
          sourceEventId: options.sourceEventId,
          metadata: options.metadata,
          priority: options.priority,
        }),
      );
    }
    return decisions;
  }

  private async proposeChunk(
    target: "topic" | "response",
    text: string,
    emotion: string,
    options: {
      groupId: string;
      sequence: number;
      sourceEventId?: string;
      metadata?: Record<string, any>;
      priority?: number;
    },
  ): Promise<StageOutputDecision> {
    const isUrgent = options.priority && options.priority >= ProposalPriority.URGENT;

    // 响应弹幕使用 direct_response，以便在舞台繁忙时能排在话题托管前面
    const lane: OutputLane = isUrgent ? "emergency" : target === "response" ? "direct_response" : "topic_hosting";
    const salience: OutputSalience = isUrgent ? "high" : target === "response" ? "medium" : "low";
    const priority =
      options.priority ?? (target === "response" ? ProposalPriority.STRATEGIC : ProposalPriority.STRATEGIC - 10);

    return this.context.stageOutput.propose({
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cursorId: this.cursorId,
      sourceEventId: options.sourceEventId,
      groupId: options.groupId,
      sequence: options.sequence,
      lane,
      priority,
      salience,
      text: text,
      summary: text,
      ttlMs: target === "response" ? 15_000 : 30_000,
      interrupt: isUrgent ? "hard" : target === "response" ? "soft" : "none",
      output: {
        caption: true,
        tts: Boolean(this.context.config.live.ttsEnabled),
        expression: expressionForEmotion(emotion),
        motion: motionForEmotion(emotion),
      },
      metadata: {
        source: target,
        groupId: options.groupId,
        sequence: options.sequence,
        ...options.metadata,
      },
    });
  }

  // === State Tracking ===
  public recordCompleted(text: string): void {
    this.recentSpeech.push(text);
    if (this.recentSpeech.length > 5) this.recentSpeech.shift();
  }

  public getRecentSpeech(): string[] {
    return [...this.recentSpeech];
  }

  public getQueueStats() {
    return { topic: 0, response: 0 }; // Queues are now in StageOutputArbiter
  }
}

// === Asset Mapping Helpers ===
function expressionForEmotion(emotion: string): string | undefined {
  const map: Record<string, string> = {
    happy: "exp_01",
    laughing: "exp_02",
    surprised: "exp_03",
    thinking: "exp_04",
    sad: "exp_05",
    teasing: "exp_06",
  };
  return map[emotion];
}

function motionForEmotion(emotion: string): string | undefined {
  if (emotion === "laughing" || emotion === "surprised" || emotion === "teasing") return "TapBody";
  return undefined;
}
