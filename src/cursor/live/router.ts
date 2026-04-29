import { asRecord, enumValue } from "../../utils/json.js";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import type { CursorContext } from "../types.js";
import type { LiveBatchDecision, LiveComposeInput, LiveEmotion } from "./types.js";
import type { BehaviorPolicyOverlay } from "../policy_overlay_store.js";

/**
 * 模块：Live Router (决策与思维)
 */
export class LiveRouter {
  constructor(private readonly context: CursorContext, private readonly persona: string) {}

  /**
   * 决策：分析弹幕批次并生成回复策略
   */
  public async decide(batch: NormalizedLiveEvent[], recentSpeech: string[], currentEmotion: string, activePolicies: BehaviorPolicyOverlay[]): Promise<LiveBatchDecision> {
    const batchLog = batch.map(e => `[${e.priority}] ${e.user?.name ?? "观众"}: ${e.text}`).join("\n");
    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);
    const safePolicies = filterLivePolicies(activePolicies, batch);

    const directiveBlock = safePolicies.length 
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies.map(p => {
          const parts = [];
          if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
          if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
          if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
          if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
          return `- ${parts.join(" | ")}`;
        }).join("\n")}`
      : "";

    const prompt = [
      this.persona,
      "You are the Live Strategic Router. Decision Layer.",
      cleanLiveMemoryBlock(subconscious, batch) ? `Internal subconscious guidance:\n${cleanLiveMemoryBlock(subconscious, batch)}` : undefined,
      directiveBlock,
      `Current Focus:\n${cleanLiveMemoryBlock(focus, batch) ?? "Relaxed chatting"}`,
      `What you just said (DO NOT REPEAT):\n${recentSpeech.join("\n") || "(Silent)"}`,
      `Current Emotion: ${currentEmotion}`,
      "\nAvailable Tools for Live Planning:",
      "- memory.search: { text: 'query' } (Deep search history)",
      "- memory.read_recent: { limit: 10 } (Quick glance)",
      "- live.status: {} (Check stage)",
      "- obs.status: {} (Check OBS)",
      "- search.web_search: { query: '...' } (Web search)",
      "\nReturn JSON with exactly this shape:",
      '{"action":"respond_to_crowd|respond_to_specific|drop_noise|generate_topic","emotion":"neutral|happy|laughing|sad|surprised|thinking|teasing","intensity":1-5,"script":"spoken reply in Simplified Chinese","reason":"short reason","tool_plan":{"calls":[{"tool":"memory.search","parameters":{"text":"..."}}]}}',
      "Language: reply in concise Simplified Chinese by default.",
      "Hard rule: answer the latest chat batch directly when it contains a real viewer question or greeting.",
      "Hard rule: ordinary low-priority danmaku is not noise by itself. Drop only empty text, repeated numbers, pure check-ins, spam, or unsafe topics.",
      "Hard rule: do not use cat/meow/喵 or snack/猫粮 topics unless the latest chat batch explicitly asks for that exact bit.",
      `\nLATEST CHAT BATCH:\n${batchLog}`
    ].filter(Boolean).join("\n\n");

    const decision = await this.context.llm.generateJson(
      prompt,
      "live_batch_decision",
      (raw) => {
        const v = asRecord(raw);
        const tp = asRecord(v.tool_plan || v.toolPlan);

        let toolPlan: LiveBatchDecision["toolPlan"];
        if (Array.isArray(tp.calls)) {
          toolPlan = {
            calls: tp.calls.map((c: any) => ({
              tool: String(asRecord(c).tool),
              parameters: asRecord(asRecord(c).parameters)
            }))
          };
        }

        return {
          action: enumValue(v.action, ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const, "drop_noise"),
          emotion: enumValue(v.emotion, ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const, "neutral") as LiveEmotion,
          intensity: typeof v.intensity === "number" ? v.intensity : 3,
          script: sanitizeExternalText(String(v.script || "")),
          reason: String(v.reason || "auto"),
          toolPlan
        };
      },
      {
        role: "primary",
        temperature: 0.65,
        safeDefault: {
          action: "drop_noise",
          emotion: "neutral",
          intensity: 3,
          script: "",
          reason: "llm_error_fallback",
        },
      }
    );
    return repairSilentDecision(decision, batch);
  }

  /**
   * 话题：在冷场时生成一个新话题
   */
  public async generateTopic(recentSpeech: string[], _currentEmotion: string, activePolicies: BehaviorPolicyOverlay[]): Promise<string> {
    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);
    const safePolicies = filterLivePolicies(activePolicies, []);

    const directiveBlock = safePolicies.length 
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies.map(p => {
          const parts = [];
          if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
          if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
          if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
          if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
          return `- ${parts.join(" | ")}`;
        }).join("\n")}`
      : "";

    const prompt = [
      this.persona,
      cleanLiveMemoryBlock(subconscious, []) ? `Internal subconscious guidance:\n${cleanLiveMemoryBlock(subconscious, [])}` : undefined,
      directiveBlock,
      "Chat is quiet. Generate ONE short, engaging sentence in concise Simplified Chinese to keep the stream lively.",
      "Do not use cat/meow/喵, snack, snack crime, or 猫粮 themes for idle filler.",
      `Current Focus:\n${cleanLiveMemoryBlock(focus, []) ?? "Relaxed chatting"}`,
      `What you just said:\n${recentSpeech.join("\n") || "(none)"}`
    ].filter(Boolean).join("\n\n");

    return this.context.llm.generateText(prompt, { role: "secondary", temperature: 0.8 });
  }

  /**
   * 二阶段合成：工具执行完后，用真实 toolResults 生成最终台词。
   */
  public async compose(input: LiveComposeInput): Promise<LiveBatchDecision> {
    if (!input.toolResults.length) return input.initialDecision;

    const batchLog = input.batch.map(e => `[${e.priority}] ${e.user?.name ?? "观众"}: ${e.text}`).join("\n");
    const toolBlock = input.toolResults.map((r) => {
      const data = r.data ? `\nData: ${truncateText(JSON.stringify(r.data), 1200)}` : "";
      return `- ${r.name}: ${r.ok ? "ok" : "failed"} | ${r.summary}${data}`;
    }).join("\n");
    const safePolicies = filterLivePolicies(input.activePolicies, input.batch);
    const directiveBlock = safePolicies.length
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies.map(formatPolicy).join("\n")}`
      : "";

    const prompt = [
      this.persona,
      "You are the Live Responder. Compose the final spoken response using the executed tool results.",
      directiveBlock,
      `Initial router decision: ${input.initialDecision.action} / ${input.initialDecision.reason}`,
      `Initial draft script:\n${input.initialDecision.script || "(none)"}`,
      `Tool results:\n${toolBlock}`,
      `What you just said (DO NOT REPEAT):\n${input.recentSpeech.join("\n") || "(Silent)"}`,
      `Current Emotion: ${input.currentEmotion}`,
      `LATEST CHAT BATCH:\n${batchLog}`,
      "Hard rule: final script must be grounded in the latest chat batch. Avoid stale cat/meow/snack themes unless explicitly requested in that batch.",
      "Return a short natural Simplified Chinese script. If the tools prove there is nothing useful to say, choose drop_noise."
    ].filter(Boolean).join("\n\n");

    return this.context.llm.generateJson(
      prompt,
      "live_tool_composition",
      (raw) => {
        const v = asRecord(raw);
        return {
          action: enumValue(v.action, ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const, input.initialDecision.action),
          emotion: enumValue(v.emotion, ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const, input.initialDecision.emotion) as LiveEmotion,
          intensity: typeof v.intensity === "number" ? v.intensity : input.initialDecision.intensity,
          script: sanitizeExternalText(String(v.script || input.initialDecision.script || "")),
          reason: String(v.reason || "tool_composed"),
          toolPlan: undefined
        };
      },
      {
        role: "primary",
        temperature: 0.55,
        maxOutputTokens: 400,
        safeDefault: {
          action: input.initialDecision.action,
          emotion: input.initialDecision.emotion,
          intensity: input.initialDecision.intensity,
          script: input.initialDecision.script,
          reason: "tool_composition_fallback",
        },
      }
    );
  }
}

function formatPolicy(p: BehaviorPolicyOverlay): string {
  const parts = [];
  if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
  if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
  if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
  if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
  return `- ${parts.join(" | ")}`;
}

function filterLivePolicies(policies: BehaviorPolicyOverlay[], batch: NormalizedLiveEvent[]): BehaviorPolicyOverlay[] {
  const latestText = batch.map(e => e.text).join("\n");
  const allowCatBit = /猫娘|喵|猫口吻|猫的口吻|扮猫|catgirl|meow|nya/i.test(latestText);
  const allowSnackBit = /零食|小吃|猫粮|snack|薯片|饼干|夜宵/i.test(latestText);
  return policies.filter(policy => {
    const text = [policy.instruction, policy.focusTopic].filter(Boolean).join("\n");
    if (!allowCatBit && /猫娘|猫口吻|喵|meow|nya|catgirl/i.test(text)) return false;
    if (!allowSnackBit && /snack|零食|猫粮|snack crime|snack detective|snack confession/i.test(text)) return false;
    return true;
  });
}

function cleanLiveMemoryBlock(value: string | null | undefined, batch: NormalizedLiveEvent[]): string | undefined {
  if (!value) return undefined;
  const latestText = batch.map(e => e.text).join("\n");
  const allowCatBit = /猫娘|喵|猫口吻|猫的口吻|扮猫|catgirl|meow|nya/i.test(latestText);
  const allowSnackBit = /零食|小吃|猫粮|snack|薯片|饼干|夜宵/i.test(latestText);
  const lines = value.split(/\r?\n/).filter(line => {
    if (!allowCatBit && /猫娘|猫口吻|喵|meow|nya|catgirl/i.test(line)) return false;
    if (!allowSnackBit && /snack|零食|猫粮|snack crime|snack detective|snack confession/i.test(line)) return false;
    return true;
  });
  const cleaned = lines.join("\n").trim();
  return cleaned || undefined;
}

function repairSilentDecision(decision: LiveBatchDecision, batch: NormalizedLiveEvent[]): LiveBatchDecision {
  if (decision.action !== "drop_noise" && decision.script.trim()) return decision;
  const target = [...batch].reverse().find(isAddressableEvent);
  if (!target) return decision;
  return {
    ...decision,
    action: "respond_to_specific",
    emotion: decision.emotion === "neutral" ? "happy" : decision.emotion,
    intensity: Math.max(decision.intensity || 3, 3),
    script: fallbackReply(target),
    reason: `forced_reply_for_addressable_danmaku; original=${decision.reason}`,
    toolPlan: undefined,
  };
}

function isAddressableEvent(event: NormalizedLiveEvent): boolean {
  if (event.kind !== "danmaku" && event.kind !== "super_chat" && event.kind !== "unknown") return false;
  const text = event.text.trim();
  if (text.length < 2) return false;
  if (/^[0-9+?？!！。.，,\s]+$/u.test(text)) return false;
  if (/^签到|^打卡|^[+1]+$/u.test(text)) return false;
  return /[?？吗呢呀]|测试|能看到|在吗|你好|晚上好|早上好|下午好|来了|hello|hi/i.test(text) || text.length >= 6;
}

function fallbackReply(event: NormalizedLiveEvent): string {
  const name = event.user?.name && event.user.name !== "观众" ? `${event.user.name}，` : "";
  const text = event.text.trim();
  if (/测试|能看到|在吗/i.test(text)) return `${name}能看到，你这条弹幕已经进来了。`;
  if (/晚上好/.test(text)) return `${name}晚上好，看到你啦。`;
  if (/早上好/.test(text)) return `${name}早上好，今天状态怎么样？`;
  if (/下午好/.test(text)) return `${name}下午好，弹幕我看到了。`;
  if (/你好|hello|hi/i.test(text)) return `${name}你好呀，欢迎来直播间。`;
  if (/[?？吗呢呀]/.test(text)) return `${name}这个我看到了，简单说，我会先按你这条来接。`;
  return `${name}看到这条了，我接一下：${truncateText(text, 36)}`;
}
