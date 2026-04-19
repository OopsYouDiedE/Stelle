import type OpenAI from "openai";
import type {
  AgentRunResult,
  AgentStatusUpdate,
  ToolCallTrace,
  ToolContext,
} from "./types.js";
import { ToolRegistry } from "./registry.js";

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: any[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface RunAgentLoopOptions {
  client: OpenAI;
  model: string;
  registry: ToolRegistry;
  systemPrompt: string;
  userPrompt: string;
  context?: ToolContext;
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
  onStatus?: (update: AgentStatusUpdate) => Promise<void> | void;
}

function preview(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export async function runAgentLoop(
  options: RunAgentLoopOptions
): Promise<AgentRunResult> {
  const {
    client,
    model,
    registry,
    systemPrompt,
    userPrompt,
    context,
    temperature = 0.7,
    maxTokens = 4096,
    maxRounds = 8,
    onStatus,
  } = options;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const toolTrace: ToolCallTrace[] = [];
  const tools = registry.getSchemas();

  await onStatus?.({
    phase: "start",
    message: "Agent started reasoning and may call tools.",
  });

  for (let round = 0; round < maxRounds; round += 1) {
    await onStatus?.({
      phase: "round",
      round: round + 1,
      message: `Starting reasoning round ${round + 1}.`,
    });

    const response = await client.chat.completions.create({
      model,
      messages,
      tools: tools as any,
      temperature,
      max_tokens: maxTokens,
    });

    const message = response.choices[0]?.message;
    const toolCalls = message?.tool_calls ?? [];

    if (!toolCalls.length) {
      await onStatus?.({
        phase: "done",
        round: round + 1,
        message: "Agent finished and is preparing the final reply.",
      });
      return {
        text: (message?.content ?? "").trim(),
        toolTrace,
      };
    }

    messages.push({
      role: "assistant",
      content: message?.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      await onStatus?.({
        phase: "tool_start",
        round: round + 1,
        toolName: call.function.name,
        toolArgs: args,
        message: `Calling tool ${call.function.name}.`,
      });

      const result = await registry.execute(
        call.function.name,
        call.function.arguments,
        context
      );

      toolTrace.push({
        name: call.function.name,
        args,
        resultPreview: preview(result),
      });
      await onStatus?.({
        phase: "tool_end",
        round: round + 1,
        toolName: call.function.name,
        toolArgs: args,
        resultPreview: preview(result),
        message: `Tool ${call.function.name} completed.`,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  await onStatus?.({
    phase: "error",
    message: "Agent hit the safety limit before producing a final answer.",
  });

  return {
    text: "I hit the tool-call safety limit before producing a final answer.",
    toolTrace,
  };
}
