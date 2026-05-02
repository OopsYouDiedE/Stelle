import type { OutputIntent, StageOutputRenderer } from "../../capabilities/expression/stage_output/types.js";
import type { LiveRendererServer } from "./renderer/renderer_server.js";

export class StageWindowOutputRenderer implements StageOutputRenderer {
  constructor(private readonly getServer: () => LiveRendererServer | undefined) {}

  async stopCurrentOutput(): Promise<void> {
    this.getServer()?.publish({ type: "caption:clear" });
    this.getServer()?.publish({ type: "audio:status", status: "stopped" });
  }

  async render(intent: OutputIntent, signal?: AbortSignal): Promise<void> {
    const server = this.getServer();
    if (!server || signal?.aborted) return;

    if (intent.output.expression) {
      server.publish({ type: "expression:set", expression: intent.output.expression });
    }
    if (signal?.aborted) return;

    if (intent.output.motion) {
      server.publish({ type: "motion:trigger", group: intent.output.motion, priority: "normal" });
    }
    if (signal?.aborted) return;

    server.publish({
      type: "event:push",
      eventId: intent.id,
      lane: stageLaneToRendererLane(intent.lane),
      text: intent.summary ?? intent.text,
      userName: intent.cursorId,
      priority: intent.salience === "critical" || intent.salience === "high" ? "high" : intent.salience,
    });

    if (intent.output.caption) {
      server.publish({ type: "caption:stream", text: intent.text, speaker: "Stelle" });
    }
  }
}

function stageLaneToRendererLane(lane: OutputIntent["lane"]): "incoming" | "response" | "topic" | "system" {
  if (lane === "topic_hosting") return "topic";
  if (lane === "debug" || lane === "emergency" || lane === "inner_reaction") return "system";
  return "response";
}
