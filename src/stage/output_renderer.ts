// === Imports ===
import type {
  StageOutputRenderer as StageOutputRendererContract,
  StageOutputRendererDeps,
  OutputIntent,
  StageOutputDeliveryRecord,
  StageOutputDeliveryReport,
} from "./output_types.js";
import type { ToolContext, ToolResult } from "../tool.js";

// === Constants ===
const LIVE_STAGE_TOOLS = [
  "live.set_caption",
  "live.stream_caption",
  "live.stream_tts_caption",
  "live.panel.push_event",
  "live.trigger_motion",
  "live.set_expression",
] as const;

// === Main Class ===
/**
 * The only component that may turn stage output intent into live output tools.
 */
export class StageOutputRenderer implements StageOutputRendererContract {
  constructor(private readonly deps: StageOutputRendererDeps) {}

  async stopCurrentOutput(): Promise<void> {
    await this.deps.tools.execute(
      "live.stop_output",
      {},
      {
        caller: "stage_renderer" as const,
        cwd: this.deps.cwd,
        allowedAuthority: ["external_write" as const],
        allowedTools: ["live.stop_output"],
      },
    );
  }

  async render(intent: OutputIntent, signal?: AbortSignal): Promise<StageOutputDeliveryReport | void> {
    const toolContext = {
      caller: "stage_renderer" as const,
      cwd: this.deps.cwd,
      allowedAuthority: ["external_write" as const],
      allowedTools: [...LIVE_STAGE_TOOLS, "live.stop_output"],
      signal,
    };
    const records: StageOutputDeliveryRecord[] = [];

    if (signal?.aborted) return;

    try {
      if (intent.output.expression) {
        records.push(
          await this.executeTarget(
            "live.expression",
            "live.set_expression",
            { expression: intent.output.expression },
            toolContext,
          ),
        );
      }

      if (signal?.aborted) return;

      if (intent.output.motion) {
        records.push(
          await this.executeTarget("live.motion", "live.trigger_motion", { group: intent.output.motion }, toolContext),
        );
      }

      if (signal?.aborted) return;

      if (!intent.output.caption && !intent.output.tts && !intent.output.discordReply) return this.report(intent, records);

      if (intent.output.caption || intent.output.tts) {
        records.push(
          await this.executeTarget(
            "live.panel",
          "live.panel.push_event",
          {
            event_id: intent.id,
            lane: stageLaneToLiveLane(intent.lane),
            text: intent.summary ?? intent.text,
            user_name: intent.cursorId,
            priority:
              intent.salience === "critical" || intent.salience === "high"
                ? "high"
                : intent.salience === "medium"
                  ? "medium"
                  : "low",
          },
          toolContext,
          ),
        );
      }

      if (intent.output.tts && this.deps.ttsEnabled) {
        records.push(
          await this.executeTarget(
            "live.tts",
            "live.stream_tts_caption",
            { text: intent.text, speaker: "Stelle", rate_ms: 32 },
            toolContext,
          ),
        );
      } else if (intent.output.caption) {
        records.push(
          await this.executeTarget(
            "live.caption",
            "live.stream_caption",
            { text: intent.text, speaker: "Stelle" },
            toolContext,
          ),
        );
      }

      if (signal?.aborted) return;

      if (intent.output.discordReply) {
        const messageId = intent.output.discordReply.messageId ?? intent.sourceEventId;
        records.push(
          await this.executeTarget(
            "discord.reply",
            messageId ? "discord.reply_message" : "discord.send_message",
            messageId
              ? {
                  channel_id: intent.output.discordReply.channelId,
                  message_id: messageId,
                  content: intent.text,
                }
              : {
                  channel_id: intent.output.discordReply.channelId,
                  content: intent.text,
                },
            {
              ...toolContext,
              allowedTools: [...toolContext.allowedTools, "discord.reply_message", "discord.send_message"],
            },
          ),
        );
      }
    } finally {
      // No more fire-and-forget abort listener here.
    }
    return this.report(intent, records);
  }

  private async executeTarget(
    target: StageOutputDeliveryRecord["target"],
    tool: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<StageOutputDeliveryRecord> {
    try {
      const result: ToolResult = await this.deps.tools.execute(tool, input, context);
      return {
        target,
        ok: result.ok,
        summary: result.summary,
        errorCode: result.error?.code,
      };
    } catch (error) {
      return {
        target,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private report(intent: OutputIntent, records: StageOutputDeliveryRecord[]): StageOutputDeliveryReport {
    return { outputId: intent.id, records };
  }
}

// === Helpers ===
function stageLaneToLiveLane(lane: OutputIntent["lane"]): "incoming" | "response" | "topic" | "system" {
  if (lane === "topic_hosting") return "topic";
  if (lane === "debug" || lane === "emergency" || lane === "inner_reaction") return "system";
  return "response";
}
