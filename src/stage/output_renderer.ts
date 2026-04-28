import type { StageOutputRenderer as StageOutputRendererContract, StageOutputRendererDeps, OutputIntent } from "./output_types.js";

const LIVE_STAGE_TOOLS = [
  "live.set_caption",
  "live.stream_caption",
  "live.stream_tts_caption",
  "live.trigger_motion",
  "live.set_expression",
] as const;

/**
 * The only component that may turn stage output intent into live output tools.
 */
export class StageOutputRenderer implements StageOutputRendererContract {
  constructor(private readonly deps: StageOutputRendererDeps) {}

  async stopCurrentOutput(): Promise<void> {
    await this.deps.tools.execute("live.stop_output", {}, {
      caller: "stage_renderer" as const,
      cwd: this.deps.cwd,
      allowedAuthority: ["external_write" as const],
      allowedTools: ["live.stop_output"],
    });
  }

  async render(intent: OutputIntent, signal?: AbortSignal): Promise<void> {
    const toolContext = {
      caller: "stage_renderer" as const,
      cwd: this.deps.cwd,
      allowedAuthority: ["external_write" as const],
      allowedTools: [...LIVE_STAGE_TOOLS, "live.stop_output"],
      signal,
    };

    if (signal?.aborted) return;

    try {
      if (intent.output.expression) {
        await this.deps.tools.execute("live.set_expression", { expression: intent.output.expression }, toolContext).catch(() => undefined);
      }

      if (signal?.aborted) return;

      if (intent.output.motion) {
        await this.deps.tools.execute("live.trigger_motion", { group: intent.output.motion }, toolContext).catch(() => undefined);
      }

      if (signal?.aborted) return;

      if (!intent.output.caption && !intent.output.tts) return;

      if (intent.output.tts && this.deps.ttsEnabled) {
        await this.deps.tools.execute("live.stream_tts_caption", { text: intent.text }, toolContext);
        return;
      }

      if (signal?.aborted) return;

      if (intent.output.caption) {
        await this.deps.tools.execute("live.stream_caption", { text: intent.text, speaker: "Stelle" }, toolContext);
      }
    } finally {
      // No more fire-and-forget abort listener here.
    }
  }
}
