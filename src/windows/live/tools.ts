import { z } from "zod";
import type { LiveRuntime } from "../stage/bridge/live_runtime.js";
import { ok, sideEffects } from "../../capabilities/tooling/types.js";
import type { ToolDefinition } from "../../capabilities/tooling/types.js";
import type { ToolRegistryDeps } from "../../capabilities/tooling/deps.js";

export function createLiveTools(deps: ToolRegistryDeps): ToolDefinition[] {
  const liveRequired = (): LiveRuntime => {
    if (!deps.live) throw new Error("Live runtime is not configured.");
    return deps.live;
  };

  return [
    {
      name: "live.status",
      title: "Live Status",
      description: "Read live status.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects(),
      async execute() {
        return ok("Live status read.", { status: await liveRequired().getStatus() });
      },
    },
    liveActionTool("live.set_caption", "Set Caption", z.object({ text: z.string().min(1) }), async (live, input) =>
      live.setCaption(input.text),
    ),
    liveActionTool(
      "live.stream_caption",
      "Stream Caption",
      z.object({
        text: z.string().min(1),
        speaker: z.string().optional(),
        rate_ms: z.number().int().optional().default(34),
      }),
      async (live, input) => live.streamCaption(input.text, input.speaker, input.rate_ms),
    ),
    livePanelEventTool("live.panel.push_event", "Push Live Panel Event"),
    livePanelEventTool("live.push_event", "Push Event"),
    liveActionTool(
      "live.trigger_motion",
      "Trigger Motion",
      z.object({ group: z.string().min(1), priority: z.enum(["normal", "force"]).optional().default("normal") }),
      async (live, input) => live.triggerMotion(input.group, input.priority as any),
    ),
    liveActionTool(
      "live.set_expression",
      "Set Expression",
      z.object({ expression: z.string().min(1) }),
      async (live, input) => live.setExpression(input.expression),
    ),
    {
      name: "live.stop_output",
      title: "Stop Output",
      description: "Stop all current live stage output (audio, TTS, caption).",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }),
      async execute() {
        const live = liveRequired();
        await Promise.all([live.clearCaption(), live.stopAudio()]);
        return ok("Stopped all stage output.");
      },
    },
    {
      name: "live.stream_tts_caption",
      title: "Stream TTS",
      description: "Synthesize speech and display caption simultaneously.",
      authority: "external_write",
      inputSchema: z.object({
        text: z.string().min(1),
        voice_name: z.string().optional(),
        speaker: z.string().optional(),
        rate_ms: z.number().int().optional().default(34),
      }),
      sideEffects: sideEffects({
        externalVisible: true,
        networkAccess: true,
        consumesBudget: true,
        affectsUserState: true,
      }),
      async execute(input) {
        const live = liveRequired();
        const result = await live.playTtsStream(input.text, {
          voice: input.voice_name,
          speaker: input.speaker ?? "Stelle",
          rateMs: input.rate_ms,
        });
        return ok(result.summary, { result });
      },
    },
    {
      name: "obs.status",
      title: "OBS Status",
      description: "Check if OBS websocket is connected.",
      authority: "readonly",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ networkAccess: true }),
      async execute() {
        return ok("OBS status read.", { status: (await liveRequired().getStatus()).obs });
      },
    },
    {
      name: "obs.start_stream",
      title: "Start OBS Stream",
      description: "Start streaming through OBS WebSocket.",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute() {
        const result = await liveRequired().obs.startStream();
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
    {
      name: "obs.stop_stream",
      title: "Stop OBS Stream",
      description: "Stop streaming through OBS WebSocket.",
      authority: "external_write",
      inputSchema: z.object({}),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute() {
        const result = await liveRequired().obs.stopStream();
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
    {
      name: "obs.set_scene",
      title: "Set OBS Scene",
      description: "Switch the current OBS program scene.",
      authority: "external_write",
      inputSchema: z.object({ scene_name: z.string().min(1) }),
      sideEffects: sideEffects({ externalVisible: true, networkAccess: true, affectsUserState: true }),
      async execute(input) {
        const result = await liveRequired().obs.setCurrentScene(input.scene_name);
        return { ok: result.ok, summary: result.summary, data: { result }, error: result.error };
      },
    },
    {
      name: "live.update_topic",
      title: "Update Live Topic",
      description:
        "Update the current live stream topic and engagement question. Use this when the conversation naturally shifts or you want to introduce a better interactive topic.",
      authority: "external_write",
      inputSchema: z.object({
        title: z.string().describe("The new topic title"),
        current_question: z.string().describe("A provocative question to engage the audience with this new topic"),
        reason: z.string().describe("Internal reason for the shift"),
      }),
      sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }),
      async execute(input) {
        deps.eventBus?.publish({
          type: "program.control.command",
          source: "tool_executor",
          id: `tool-topic-${Date.now()}`,
          timestamp: Date.now(),
          payload: {
            action: "topic_orchestrator.update",
            parameters: { title: input.title, currentQuestion: input.current_question, reason: input.reason },
          },
        } as any);

        return ok(`Stream topic updated to: ${input.title}`, {
          title: input.title,
          current_question: input.current_question,
        });
      },
    },
  ];

  function liveActionTool<TSchema extends z.AnyZodObject>(
    name: string,
    title: string,
    inputSchema: TSchema,
    action: (live: LiveRuntime, input: z.infer<TSchema>) => Promise<{ ok: boolean; summary: string }>,
  ): ToolDefinition<TSchema> {
    return {
      name,
      title,
      description: title,
      authority: "external_write",
      inputSchema,
      sideEffects: sideEffects({ externalVisible: true, affectsUserState: true }),
      async execute(input) {
        const result = await action(liveRequired(), input);
        return {
          ok: result.ok,
          summary: result.summary,
          data: { result },
          sideEffects: [{ type: name, summary: result.summary, visible: true, timestamp: Date.now() }],
        };
      },
    };
  }

  function livePanelEventTool(name: string, title: string): ToolDefinition {
    return liveActionTool(
      name,
      title,
      z.object({
        event_id: z.string().optional(),
        lane: z.enum(["incoming", "response", "topic", "system"]),
        text: z.string().min(1),
        user_name: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        note: z.string().optional(),
      }),
      async (live, input) =>
        live.pushEvent({
          eventId: input.event_id,
          lane: input.lane,
          text: input.text,
          userName: input.user_name,
          priority: input.priority,
          note: input.note,
        }),
    );
  }
}
