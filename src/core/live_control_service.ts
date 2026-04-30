import type { RuntimeConfig } from "../config/index.js";
import type { StelleEventBus } from "../utils/event_bus.js";
import type { StageOutputArbiter } from "../actuator/output_arbiter.js";

export interface LiveControlServiceDeps {
  config: RuntimeConfig;
  eventBus: StelleEventBus;
  stageOutput: StageOutputArbiter;
  now: () => number;
}

export class LiveControlService {
  constructor(private readonly deps: LiveControlServiceDeps) {}

  async runCommand(input: Record<string, unknown>) {
    const command = String(input.command ?? "");
    this.deps.eventBus.publish({
      type: "live.control.command",
      source: "control",
      id: `live-control-${this.deps.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.deps.now(),
      payload: { command, input },
    } as any);

    if (command === "stop_output") return { command, ...this.deps.stageOutput.stopCurrent("control_stop_output") };
    if (command === "clear_queue") return { command, ...this.deps.stageOutput.clearQueue("control_clear_queue") };
    if (command === "pause_auto_reply") return { command, ...this.deps.stageOutput.setAutoReplyPaused(true) };
    if (command === "resume_auto_reply") return { command, ...this.deps.stageOutput.setAutoReplyPaused(false) };
    if (command === "mute_tts") return { command, ...this.deps.stageOutput.setTtsMuted(true) };
    if (command === "unmute_tts") return { command, ...this.deps.stageOutput.setTtsMuted(false) };
    if (command === "direct_say") {
      const text = String(input.text ?? "").trim();
      if (!text) return { command, accepted: false, reason: "empty_text" };
      return this.proposeSystemLiveOutput("system", { text, directSay: true });
    }
    return { command, accepted: false, reason: "unknown_command" };
  }

  async proposeSystemLiveOutput(source: "debug" | "system", input: Record<string, unknown>) {
    const text = String(input.text ?? "").trim();
    const eventId = `${source}-live-${this.deps.now()}`;
    const forceTopic = Boolean(input.forceTopic);
    const directSay = Boolean(input.directSay);
    const lane = source === "debug" ? "debug" : directSay ? "direct_response" : forceTopic ? "topic_hosting" : "live_chat";
    const decision = await this.deps.stageOutput.propose({
      id: eventId,
      cursorId: source,
      sourceEventId: input.originMessageId ? String(input.originMessageId) : undefined,
      lane,
      priority: source === "debug" ? 80 : directSay ? 70 : 55,
      salience: directSay ? "high" : "medium",
      text,
      topic: forceTopic ? text : undefined,
      ttlMs: directSay ? 20_000 : 12_000,
      interrupt: directSay ? "soft" : "none",
      output: {
        caption: true,
        tts: Boolean(this.deps.config.live.ttsEnabled),
      },
      metadata: {
        channelId: input.channelId ? String(input.channelId) : undefined,
        authorId: input.authorId ? String(input.authorId) : undefined,
        forceTopic,
        directSay,
      },
    });

    return {
      accepted: decision.status === "accepted" || decision.status === "interrupted",
      status: decision.status,
      reason: decision.reason,
      eventId,
    };
  }
}
