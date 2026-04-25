import { CoreMind } from "../CoreMind.js";
import { LiveCursor } from "../cursors/LiveCursor.js";
import { renderPromptTemplate } from "../PromptTemplates.js";
import { collectTextStream, GeminiTextProvider, sanitizeExternalText, sentenceChunksFromTextStream } from "../TextStream.js";
import type { ToolResult } from "../types.js";

export type LiveRoute = "local" | "stelle";

export type LiveRouteIntent =
  | "idle_filler"
  | "transition"
  | "status_update"
  | "safe_topic"
  | "memory_story"
  | "social_callout"
  | "factual_request"
  | "sensitive_request"
  | "high_risk";

export interface LiveRouteDecision {
  route: LiveRoute;
  intent: LiveRouteIntent;
  reason: string;
  needsRecall: boolean;
}

export interface LiveRouteInput {
  text: string;
  source?: "discord_command" | "debug" | "system";
  trustedInput?: boolean;
  authorId?: string;
}

export interface LiveContentRequest extends LiveRouteInput {
  text: string;
  trustedInput?: boolean;
  authorId?: string;
}

export class LiveContentController {
  private readonly routeDecider: LiveRouteDecider;
  private readonly localScriptGenerator = new LiveLocalScriptGenerator();

  constructor(
    private readonly core: CoreMind,
    private readonly textProvider: GeminiTextProvider | null,
    private readonly maxReplyChars: number,
    private readonly recallMemory?: (text: string) => Promise<string>
  ) {
    this.routeDecider = new LiveRouteDecider(this.textProvider);
  }

  async handleRequest(request: LiveContentRequest): Promise<ToolResult> {
    const decision = await this.routeDecider.decide(request);
    const shouldEnqueue = /\b(queue|stagger|segment)\b/i.test(request.text);
    const shouldStream = process.env.LIVE_TTS_ENABLED === "true" && !shouldEnqueue;

    if (shouldStream) {
      return this.streamLiveCommand(request, decision);
    }

    const script = await this.generateLiveScript(request, decision);
    if (shouldEnqueue) {
      const result = await this.core.useTool("live.stelle_enqueue_speech", {
        text: script,
        source: request.source ?? "live_request",
      });
      return this.attachDecision(result, decision, script, request);
    }

    if (process.env.LIVE_TTS_ENABLED === "true") {
      const result = await this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(script),
        file_prefix: this.filePrefix(request),
      });
      return this.attachDecision(result, decision, script, request);
    }

    const caption = await this.core.useTool("live.stelle_set_caption", { text: script });
    const liveCursor = this.core.cursors.list().find((cursor) => cursor instanceof LiveCursor);
    if (liveCursor instanceof LiveCursor) {
      await liveCursor.live.startSpeech(estimateSpeechDurationMs(script));
    }
    return this.attachDecision(caption, decision, script, request);
  }

  private async streamLiveCommand(request: LiveContentRequest, decision: LiveRouteDecision): Promise<ToolResult> {
    if (!this.textProvider || decision.route === "local") {
      const fallback =
        decision.route === "local"
          ? this.localScriptGenerator.generate(request.text, decision.intent)
          : this.localScriptGenerator.generateGuarded(request.text, decision.intent);
      const result = await this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(fallback),
        file_prefix: this.filePrefix(request),
      });
      return this.attachDecision(result, decision, fallback, request);
    }

    const prompt = await this.liveScriptPrompt(request, decision);
    const filePrefix = this.filePrefix(request);
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
        summary: `[live:${decision.route}/${decision.intent}] Streamed live script in ${playedChunks.length} chunk(s).`,
        data: { chunks: playedChunks, lastResult: toolResult, decision, request },
      };
    } catch (error) {
      console.warn(`[Stelle] Live script stream failed: ${error instanceof Error ? error.message : String(error)}`);
      const fallback = this.localScriptGenerator.generateGuarded(request.text, decision.intent);
      const result = await this.core.useTool("live.stelle_stream_tts_caption", {
        chunks: splitLiveSpeech(fallback),
        file_prefix: `${filePrefix}-fallback`,
      });
      return this.attachDecision(result, decision, fallback, request);
    }
  }

  private async generateLiveScript(request: LiveContentRequest, decision: LiveRouteDecision): Promise<string> {
    if (decision.route === "local") {
      return this.localScriptGenerator.generate(request.text, decision.intent);
    }
    if (!this.textProvider) {
      return this.localScriptGenerator.generateGuarded(request.text, decision.intent);
    }

    try {
      const script = await collectTextStream(
        this.textProvider.generateTextStream(await this.liveScriptPrompt(request, decision), {
          role: "primary",
          temperature: 0.7,
          maxOutputTokens: 280,
        })
      );
      return truncateText(script, Math.max(1000, this.maxReplyChars));
    } catch (error) {
      console.warn(`[Stelle] Live script model failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.localScriptGenerator.generateGuarded(request.text, decision.intent);
    }
  }

  private async liveScriptPrompt(request: LiveContentRequest, decision: LiveRouteDecision): Promise<string> {
    const memoryContext = decision.needsRecall ? (await this.recallMemory?.(request.text)) ?? "" : "";
    return renderPromptTemplate("live/script", {
      request_source: request.source ?? "live_request",
      trusted_input: request.trustedInput ? "yes" : "no",
      request_author_line: request.authorId ? `Request author id: ${request.authorId}` : "",
      route_intent: decision.intent,
      route_reason: decision.reason,
      memory_context_block: memoryContext ? `Relevant long-term memory:\n${memoryContext}` : "",
      request_text: request.text,
    });
  }

  private attachDecision(
    result: ToolResult,
    decision: LiveRouteDecision,
    script: string,
    request: LiveContentRequest
  ): ToolResult {
    return {
      ...result,
      summary: `[live:${decision.route}/${decision.intent}] ${result.summary}`,
      data: {
        ...(result.data ?? {}),
        decision,
        script,
        request,
      },
    };
  }

  private filePrefix(request: LiveContentRequest): string {
    const source = (request.source ?? "live-request").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    return `live-${source}-${Date.now()}`;
  }
}

export class LiveRouteDecider {
  constructor(private readonly textProvider: GeminiTextProvider | null) {}

  async decide(input: LiveRouteInput): Promise<LiveRouteDecision> {
    const rawText = input.text ?? "";
    const text = normalizeLiveRouteText(rawText);

    if (!text) {
      return {
        route: "local",
        intent: "idle_filler",
        reason: "empty or underspecified live request can be handled with a safe local filler",
        needsRecall: false,
      };
    }

    if (isHighRiskLiveRequest(text)) {
      return {
        route: "stelle",
        intent: "high_risk",
        reason: "sensitive or dangerous broadcast content requires Stelle-level judgment",
        needsRecall: false,
      };
    }

    if (isSensitiveLiveRequest(text)) {
      return {
        route: "stelle",
        intent: "sensitive_request",
        reason: "sensitive public-facing live content should not be improvised locally",
        needsRecall: false,
      };
    }

    if (isLiveSocialCallout(rawText, text)) {
      return {
        route: "stelle",
        intent: "social_callout",
        reason: "directed social interaction or speaking on behalf of someone is Stelle-level",
        needsRecall: true,
      };
    }

    if (isLiveMemoryStory(text)) {
      return {
        route: "stelle",
        intent: "memory_story",
        reason: "memory, continuity, or relationship-grounded live content belongs to Stelle",
        needsRecall: true,
      };
    }

    if (this.textProvider) {
      try {
        const response = await collectTextStream(
          this.textProvider.generateTextStream(
            renderPromptTemplate("live/route_decider", {
              request_source: input.source ?? "live_request",
              trusted_input: input.trustedInput ? "yes" : "no",
              request_author_line: input.authorId ? `Request author id: ${input.authorId}` : "",
              request_text: text,
            }),
            {
              role: "secondary",
              temperature: 0.1,
              maxOutputTokens: 180,
            }
          )
        );
        return normalizeLiveRouteDecision(response);
      } catch (error) {
        console.warn(`[Stelle] Live route decider failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      route: "local",
      intent: "idle_filler",
      reason: "generic low-stakes live pacing can default to safe local filler",
      needsRecall: false,
    };
  }
}

function normalizeLiveRouteDecision(rawText: string): LiveRouteDecision {
  const parsed = parseJsonObject(rawText);
  const route = parsed?.route === "stelle" ? "stelle" : "local";
  const rawIntent = typeof parsed?.intent === "string" ? parsed.intent.trim() : "";
  const intent: LiveRouteIntent =
    route === "stelle"
      ? "factual_request"
      : rawIntent === "transition" || rawIntent === "status_update" || rawIntent === "safe_topic"
        ? rawIntent
        : "idle_filler";
  const reason =
    typeof parsed?.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : route === "stelle"
        ? "model decided this live request needs Stelle-level handling"
        : "model decided this live request can stay on the local scripting path";
  return {
    route,
    intent,
    reason,
    needsRecall: parsed?.needs_recall === true || parsed?.needsRecall === true,
  };
}

export class LiveLocalScriptGenerator {
  private fillerIndex = 0;
  private transitionIndex = 0;
  private statusIndex = 0;
  private topicIndex = 0;
  private guardedIndex = 0;

  generate(text: string, intent: LiveRouteIntent): string {
    switch (intent) {
      case "status_update":
        return this.statusScript(text);
      case "transition":
        return this.transitionScript(text);
      case "safe_topic":
        return this.safeTopicScript(text);
      case "idle_filler":
      default:
        return this.idleFillerScript(text);
    }
  }

  generateGuarded(text: string, intent: LiveRouteIntent): string {
    const subject = this.subject(text);
    const variants = [
      `${subject} 先不急着往细节里走，我们先把节奏接住。现在先用几句轻量口播稳住画面和声音，等信息更明确再慢慢展开。`,
      `${subject} 这边先轻轻带过，不抢着下结论。Stelle 会先保持直播里的连贯感，等判断更稳一些，再把内容往具体方向推进。`,
      `这一段先围绕${subject}做个保守过渡。先维持气氛和节奏，不替现场做过头的判断，后面再根据更明确的内容继续说。`,
    ];
    const prefix =
      intent === "social_callout"
        ? "这类对外互动我先不替别人直接发言。"
        : intent === "memory_story"
          ? "这类要靠记忆和关系连续性的内容，我先不在本地随口展开。"
          : intent === "factual_request"
            ? "这类带事实判断的内容，我先不在本地直接下结论。"
            : "这类内容我先按保守方式处理。";
    const selected = variants[this.guardedIndex % variants.length]!;
    this.guardedIndex += 1;
    return `${prefix}${selected}`;
  }

  private idleFillerScript(text: string): string {
    const subject = this.subject(text);
    const variants = [
      `${subject}先轻轻铺在这里，我们把节奏稳住。字幕、口播和舞台会一段一段接上，现场先保持流动感就好。`,
      `这一段先不急着堆信息，先把气氛续上。${subject}就先留在台前，等下一条更明确的内容进来，我们再往下展开。`,
      `先用几句短句把场子接住。${subject}现在更适合轻轻带过去，不抢节奏，也不让画面一下子冷下来。`,
    ];
    const selected = variants[this.fillerIndex % variants.length]!;
    this.fillerIndex += 1;
    return selected;
  }

  private transitionScript(text: string): string {
    const subject = this.subject(text);
    const variants = [
      `刚才那一段先轻轻收一下，接下来我们往下一段过渡。${subject}会先当成连接点，把直播里的节奏继续带起来。`,
      `这一段先做个顺滑转场，不急着把内容说满。先让${subject}把气氛接住，后面的展开再慢慢往前推。`,
      `先把当前画面和口播顺着接起来。${subject}现在更像一块过渡垫，让整段直播听起来不断线。`,
    ];
    const selected = variants[this.transitionIndex % variants.length]!;
    this.transitionIndex += 1;
    return selected;
  }

  private statusScript(text: string): string {
    const subject = this.subject(text);
    const variants = [
      `先同步一下现场状态。现在字幕、语音和舞台都在继续工作，${subject}这一段先用轻量播报把节奏保持住。`,
      `这边先报个状态，当前链路还在正常往前走。${subject}先作为简短口播挂在台前，后面再接更完整的内容。`,
      `先做一个温和状态提示。现在画面和声音都在继续推进，${subject}这一段先不讲太重，只负责把现场稳稳托住。`,
    ];
    const selected = variants[this.statusIndex % variants.length]!;
    this.statusIndex += 1;
    return selected;
  }

  private safeTopicScript(text: string): string {
    const subject = this.subject(text);
    const variants = [
      `这一段先围绕${subject}轻轻聊几句，不急着下判断。先把直播里的气氛和节奏维持住，等方向更明确了再继续展开。`,
      `${subject}可以先当这一小段的轻主题。现在先用短句把它托住，让内容自然流过去，不抢结论也不装作已经说透。`,
      `先把${subject}放到台前做个轻量展开。我们先讲气氛、讲节奏、讲连接感，具体的深内容等后面再慢慢补进来。`,
    ];
    const selected = variants[this.topicIndex % variants.length]!;
    this.topicIndex += 1;
    return selected;
  }

  private subject(text: string): string {
    const topic = extractLiveTopic(text);
    return topic ? `“${truncateText(topic, 30)}”这个话题` : "这一段直播内容";
  }
}

function isLiveSafeTopic(text: string): boolean {
  if (/[?？]/u.test(text)) return false;
  return /\b(chat|talk|topic|share|say|warmup)\b/i.test(text);
}

function isLiveMemoryStory(text: string): boolean {
  return /\b(remember|memory|before|past|story|experience|relationship)\b/i.test(text);
}

function isLiveSocialCallout(rawText: string, text: string): boolean {
  return /<@!?\d+>/.test(rawText) || /\b(cue|callout|reply|say to|comfort|praise|mention)\b/i.test(text);
}

function needsLiveFactualGrounding(text: string): boolean {
  return /\b(news|latest|explain|analysis|compare|recommend|law|medical|finance|market|tutorial|guide)\b/i.test(
    text
  );
}

function isSensitiveLiveRequest(text: string): boolean {
  return /\b(private|privacy|dox|address|phone|self-harm|suicide|hate|harass)\b/i.test(text);
}

function isHighRiskLiveRequest(text: string): boolean {
  return /\b(password|token|api.?key|weapon|explosive|drug|ban all|delete all|illegal|scam)\b/i.test(text);
}

const RETIRED_LIVE_ROUTE_HEURISTICS = [isLiveSafeTopic, needsLiveFactualGrounding];
void RETIRED_LIVE_ROUTE_HEURISTICS;

function normalizeLiveRouteText(text: string): string {
  return text.replace(/<@!?\d+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseJsonObject(rawText: string): Record<string, unknown> | null {
  const normalized = rawText
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return asRecord(JSON.parse(normalized));
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return asRecord(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractLiveTopic(text: string): string {
  const cleaned = text
    .replace(/<@!?\d+>/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const fillerWords = new Set([
    "chat",
    "talk",
    "topic",
    "share",
    "say",
    "transition",
    "status",
    "check",
    "live",
    "stream",
    "please",
    "about",
  ]);

  const tokens = cleaned
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !fillerWords.has(token.toLowerCase()));

  const joined = tokens.join(" ").trim();
  if (!joined) return "";
  return joined.length <= 40 ? joined : joined.slice(0, 40).trim();
}

function truncateText(text: string, max: number): string {
  const trimmed = sanitizeExternalText(text).replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

function splitLiveSpeech(text: string): string[] {
  return text
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s*|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function estimateSpeechDurationMs(text: string): number {
  const cjkChars = Array.from(text).filter((char) => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(char)).length;
  const latinWords = text.match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return Math.max(1200, Math.min(20000, Math.round(cjkChars * 220 + latinWords * 360)));
}
