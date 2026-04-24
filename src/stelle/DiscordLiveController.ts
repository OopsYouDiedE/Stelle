import type { CoreMind } from "../core/CoreMind.js";
import { LiveCursor } from "../cursors/live/LiveCursor.js";
import type { GeminiTextProvider } from "../gemini/GeminiTextProvider.js";
import { collectTextStream, sentenceChunksFromTextStream } from "../text/TextStream.js";
import type { ToolResult } from "../types.js";
import { estimateSpeechDurationMs, splitLiveSpeech, truncate } from "./DiscordAttachedCoreMindUtils.js";

export class DiscordLiveController {
  private liveFallbackIndex = 0;

  constructor(
    private readonly core: CoreMind,
    private readonly textProvider: GeminiTextProvider | null,
    private readonly maxReplyChars: number,
    private readonly recallMemory?: (text: string) => Promise<string>
  ) {}

  async handleLiveCommand(text: string): Promise<ToolResult> {
    const enqueue = /慢慢|队列|提前|一段一段|语料/.test(text);
    const streamed = process.env.LIVE_TTS_ENABLED === "true" && !enqueue;
    if (streamed) return this.streamLiveCommand(text);

    const script = await this.generateLiveScript(text);
    if (enqueue) {
      return this.core.useTool("live.stelle_enqueue_speech", {
        text: script,
        source: "discord_command",
      });
    }
    if (process.env.LIVE_TTS_ENABLED === "true") {
      return this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(script),
        file_prefix: `live-discord-${Date.now()}`,
      });
    }

    const caption = await this.core.useTool("live.stelle_set_caption", { text: script });
    const liveCursor = this.core.cursors.list().find((cursor) => cursor instanceof LiveCursor);
    if (liveCursor instanceof LiveCursor) {
      await liveCursor.live.startSpeech(estimateSpeechDurationMs(script));
    }
    return caption;
  }

  private async streamLiveCommand(text: string): Promise<ToolResult> {
    if (!this.textProvider) {
      const fallback = this.generateFallbackLiveScript(text);
      return this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(fallback),
        file_prefix: `live-discord-${Date.now()}`,
      });
    }

    const prompt = await this.liveScriptPrompt(text);
    const filePrefix = `live-discord-${Date.now()}`;
    const playedChunks: string[] = [];
    let toolResult: ToolResult | undefined;

    try {
      const stream = this.textProvider.generateTextStream(prompt, {
        role: "primary",
        temperature: 0.7,
        maxOutputTokens: 280,
      });
      for await (const chunk of sentenceChunksFromTextStream(stream, { maxChars: 48 })) {
        playedChunks.push(chunk);
        toolResult = await this.core.useTool("live.stelle_stream_tts_caption", {
          chunks: [chunk],
          file_prefix: `${filePrefix}-${String(playedChunks.length - 1).padStart(3, "0")}`,
        });
      }

      return {
        ok: toolResult?.ok ?? playedChunks.length > 0,
        summary: `Streamed live script in ${playedChunks.length} chunk(s).`,
        data: { chunks: playedChunks, lastResult: toolResult },
      };
    } catch (error) {
      console.warn(`[Stelle] Live script stream failed: ${error instanceof Error ? error.message : String(error)}`);
      const fallback = this.generateFallbackLiveScript(text);
      return this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(fallback),
        file_prefix: `${filePrefix}-fallback`,
      });
    }
  }

  private async generateLiveScript(text: string): Promise<string> {
    if (!this.textProvider) return this.generateFallbackLiveScript(text);

    try {
      const script = await collectTextStream(
        this.textProvider.generateTextStream(await this.liveScriptPrompt(text), {
          role: "primary",
          temperature: 0.7,
          maxOutputTokens: 280,
        })
      );
      return truncate(script, Math.max(1000, this.maxReplyChars));
    } catch (error) {
      console.warn(`[Stelle] Live script model failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.generateFallbackLiveScript(text);
    }
  }

  private async liveScriptPrompt(text: string): Promise<string> {
    const memoryContext = (await this.recallMemory?.(text)) ?? "";
    return [
      "Write short live-stream talking content for Stelle.",
      "Chinese, warm, lively, suitable for OBS captions and TTS.",
      "3-5 short sentences. No markdown.",
      memoryContext ? `Relevant long-term memory:\n${memoryContext}` : "",
      "",
      `User request: ${text}`,
    ].join("\n");
  }

  private generateFallbackLiveScript(text: string): string {
    const topic = text
      .replace(/<@!?\d+>/g, "")
      .replace(/直播|推流|添加|内容|说|来点|语料/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    const subject = topic ? `刚才提到的“${truncate(topic, 42)}”` : "现在这轮直播测试";
    const variants = [
      `${subject}，我们先把节奏放稳一点。字幕、口型和语音正在一起工作，Stelle 会一段一段把内容接上。接下来我会观察现场反馈，再把话题慢慢展开。`,
      `${subject}可以先作为这一轮的小主题。现在先不急着堆信息，先确认声音、字幕和动作都跟得上。等链路稳定之后，Stelle 就能自然地把直播间气氛续起来。`,
      `这段先围绕${subject}轻轻过一遍。直播里最重要的是不断线，所以我会用短句保持节奏。等下一条指令进来，再把内容往更具体的方向推进。`,
      `${subject}这边先记作当前话题。Stelle 会先用几句短内容维持现场，不让画面只剩静默。声音出来、口型跟上之后，再切到下一段。`,
    ];
    const selected = variants[this.liveFallbackIndex % variants.length]!;
    this.liveFallbackIndex += 1;
    return selected;
  }
}
