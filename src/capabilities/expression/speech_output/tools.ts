import { z } from "zod";
import { getConfiguredTtsProviderName, type StreamingTtsProvider } from "./tts_provider.js";
import { ok, sideEffects } from "../../tooling/types.js";
import type { ToolDefinition } from "../../tooling/types.js";

export function createTtsTools(provider: StreamingTtsProvider): ToolDefinition[] {
  return [
    {
      name: "tts.live_speech",
      title: "Live Speech",
      description: "Synthesize live speech using the configured TTS provider and save to files.",
      authority: "safe_write",
      inputSchema: z.object({
        text: z.string().min(1),
        output_dir: z.string().optional(),
        file_prefix: z.string().optional(),
        voice_name: z.string().optional(),
        language: z.string().optional(),
        instructions: z.string().optional(),
        model: z.string().optional(),
        stream: z.boolean().optional(),
      }),
      sideEffects: sideEffects({ writesFileSystem: true, networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const artifacts = await provider.synthesizeToFiles(input.text, {
          outputDir: input.output_dir,
          filePrefix: input.file_prefix,
          voiceName: input.voice_name,
          language: input.language,
          instructions: input.instructions,
          model: input.model,
          stream: input.stream,
        });
        return ok(`${getConfiguredTtsProviderName()} wrote ${artifacts.length} audio artifact(s).`, { artifacts });
      },
    },
    {
      name: "tts.kokoro_speech",
      title: "Kokoro Speech",
      description: "Backward-compatible alias for configured live speech synthesis.",
      authority: "safe_write",
      inputSchema: z.object({
        text: z.string().min(1),
        output_dir: z.string().optional(),
        file_prefix: z.string().optional(),
        voice_name: z.string().optional(),
      }),
      sideEffects: sideEffects({ writesFileSystem: true, networkAccess: true, consumesBudget: true }),
      async execute(input) {
        const artifacts = await provider.synthesizeToFiles(input.text, {
          outputDir: input.output_dir,
          filePrefix: input.file_prefix,
          voiceName: input.voice_name,
        });
        return ok(`${getConfiguredTtsProviderName()} wrote ${artifacts.length} audio artifact(s).`, { artifacts });
      },
    },
  ];
}
