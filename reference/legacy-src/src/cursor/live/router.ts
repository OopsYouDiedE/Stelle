// === Imports ===
import { asRecord, enumValue } from "../../utils/json.js";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";
import type { NormalizedLiveEvent } from "../../utils/live_event.js";
import type { CursorContext } from "../types.js";
import type { LiveBatchDecision, LiveComposeInput, LiveEmotion, LiveOutputProposal } from "./types.js";
import { ProposalPriority } from "./types.js";
import type { BehaviorPolicyOverlay, PersonaState } from "../policy_overlay_store.js";
import type { ViewerProfileSummary } from "../../live/controller/viewer_profile.js";

/**
 * 模块：Live Router (决策与思维)
 */
// === Class Definition ===
export class LiveRouter {
  constructor(
    private readonly context: CursorContext,
    private readonly persona: string,
  ) {}

  // === Strategic Decision (Phase 1) ===
  /**
   * 决策：分析弹幕批次并生成回复策略
   */
  public async decide(
    batch: NormalizedLiveEvent[],
    recentSpeech: string[],
    currentEmotion: string,
    activePolicies: BehaviorPolicyOverlay[],
    proposals: LiveOutputProposal[] = [],
    personaState?: PersonaState,
  ): Promise<LiveBatchDecision> {
    const batchLog = batch
      .map(
        (e) =>
          `[${e.priority}] ${e.user?.name ?? "观众"}${e.metadata?.intent ? ` (Intent: ${e.metadata.intent})` : ""}: ${e.text}`,
      )
      .join("\n");
    const proposalLog = proposals.length
      ? `\nSTRATEGIC PROPOSALS (From Director):\n${proposals.map((p) => `- [ID: ${p.id}] Priority: ${p.priority} | Source: ${p.intent.metadata?.source || "unknown"} | Suggested: ${p.intent.text}`).join("\n")}`
      : "";

    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);
    const safePolicies = filterLivePolicies(activePolicies, batch, personaState);
    const safeSubconscious = this.cleanMemoryBlock(subconscious, batch, personaState);
    const safeFocus = this.cleanMemoryBlock(focus, batch, personaState);
    const relationshipSummaries = await this.context.viewerProfiles?.summariesForEvents(batch).catch(() => []);

    const directiveBlock = safePolicies.length
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies
          .map((p) => {
            const parts = [];
            if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
            if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
            if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
            if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
            return `- ${parts.join(" | ")}`;
          })
          .join("\n")}`
      : "";

    const personaBlock = personaState
      ? `\nCURRENT PERSONA STATE:\n- Roleplay: ${personaState.roleplayEnabled ? "Enabled" : "Disabled"}\n- Active Bits: ${personaState.activeBits.join(", ") || "none"}\n- Intensity: ${personaState.vibeIntensity}/5\n- Tempo: ${personaState.tempo}`
      : "";

    const prompt = [
      this.persona,
      "You are the Live Strategic Router. Decision Layer.",
      "GOAL: Respond to viewers while maintaining stream flow. Weave strategic proposals (like thanks or topic summaries) into your responses naturally.",
      safeSubconscious ? `Internal subconscious guidance:\n${safeSubconscious}` : undefined,
      directiveBlock,
      personaBlock,
      `Current Focus:\n${safeFocus ?? "Relaxed chatting"}`,
      `What you just said (DO NOT REPEAT):\n${recentSpeech.join("\n") || "(Silent)"}`,
      `Current Emotion: ${currentEmotion}`,
      proposalLog,
      "\nAvailable Tools for Live Planning:",
      "- memory.search: { text: 'query' } (Deep search history)",
      "- memory.read_recent: { limit: 10 } (Quick glance)",
      "- live.status: {} (Check stage)",
      "- obs.status: {} (Check OBS)",
      "- scene.observe: {} (Read-only current scene/renderer observation; use only for screen/game/current-scene questions)",
      "- search.web_search: { query: '...' } (Web search)",
      relationshipSummaries?.length
        ? `Viewer relationship summaries:\n${relationshipSummaries.map(formatRelationshipSummary).join("\n")}`
        : undefined,
      "\nReturn JSON with exactly this shape:",
      '{"action":"respond_to_crowd|respond_to_specific|drop_noise|generate_topic","emotion":"neutral|happy|laughing|sad|surprised|thinking|teasing","intensity":1-5,"script":"spoken reply in Simplified Chinese","consumedProposalIds":["prop-id-1"],"reason":"short reason","tool_plan":{"calls":[{"tool":"memory.search","parameters":{"text":"..."}}]}}',
      "Language: reply in concise Simplified Chinese by default.",
      "Hard rule: If you weave a Strategic Proposal's content into your script, include its ID in 'consumedProposalIds'.",
      "Hard rule: Answer the latest chat batch directly when it contains a real viewer question or greeting.",
      "Hard rule: Ordinary low-priority danmaku is not noise by itself. Drop only empty text, repeated numbers, pure check-ins, spam, or unsafe topics.",
      `\nLATEST CHAT BATCH:\n${batchLog}`,
    ]
      .filter(Boolean)
      .join("\n\n");

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
              parameters: asRecord(asRecord(c).parameters),
            })),
          };
        }

        return {
          action: enumValue(
            v.action,
            ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const,
            "drop_noise",
          ),
          emotion: enumValue(
            v.emotion,
            ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const,
            "neutral",
          ) as LiveEmotion,
          intensity: typeof v.intensity === "number" ? v.intensity : 3,
          script: sanitizeExternalText(String(v.script || "")),
          reason: String(v.reason || "auto"),
          toolPlan,
          consumedProposalIds: Array.isArray(v.consumedProposalIds) ? v.consumedProposalIds.map(String) : undefined,
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
      },
    );
    return repairSilentDecision(decision, batch);
  }

  // === Topic Generation ===
  /**
   * 话题：在冷场时生成一个新话题
   */
  public async generateTopic(
    recentSpeech: string[],
    _currentEmotion: string,
    activePolicies: BehaviorPolicyOverlay[],
  ): Promise<string> {
    const focus = await this.context.memory?.readLongTerm("current_focus", "self_state").catch(() => null);
    const subconscious = await this.context.memory?.readLongTerm("global_subconscious", "self_state").catch(() => null);
    const safePolicies = filterLivePolicies(activePolicies, []);

    const directiveBlock = safePolicies.length
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies
          .map((p) => {
            const parts = [];
            if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
            if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
            if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
            if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
            return `- ${parts.join(" | ")}`;
          })
          .join("\n")}`
      : "";

    const prompt = [
      this.persona,
      this.cleanMemoryBlock(subconscious, [])
        ? `Internal subconscious guidance:\n${this.cleanMemoryBlock(subconscious, [])}`
        : undefined,
      directiveBlock,
      "Chat is quiet. Generate ONE short, engaging sentence in concise Simplified Chinese to keep the stream lively.",
      "Do not use cat/meow/喵, snack, snack crime, or 猫粮 themes for idle filler.",
      `Current Focus:\n${this.cleanMemoryBlock(focus, []) ?? "Relaxed chatting"}`,
      `What you just said:\n${recentSpeech.join("\n") || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.context.llm.generateText(prompt, { role: "secondary", temperature: 0.8 });
  }

  // === Composition (Phase 2) ===
  /**
   * 二阶段合成：工具执行完后，用真实 toolResults 生成最终台词。
   */
  public async compose(input: LiveComposeInput, personaState?: PersonaState): Promise<LiveBatchDecision> {
    if (!input.toolResults.length) return input.initialDecision;

    const batchLog = input.batch.map((e) => `[${e.priority}] ${e.user?.name ?? "观众"}: ${e.text}`).join("\n");
    const toolBlock = input.toolResults
      .map((r) => {
        const data = r.data ? `\nData: ${truncateText(JSON.stringify(r.data), 1200)}` : "";
        return `- ${r.name}: ${r.ok ? "ok" : "failed"} | ${r.summary}${data}`;
      })
      .join("\n");
    const safePolicies = filterLivePolicies(input.activePolicies, input.batch, personaState);
    const directiveBlock = safePolicies.length
      ? `\nCURRENT ACTIVE BEHAVIOR POLICIES:\n${safePolicies.map(formatPolicy).join("\n")}`
      : "";
    const personaBlock = personaState
      ? `\nCURRENT PERSONA STATE:\n- Roleplay: ${personaState.roleplayEnabled ? "Enabled" : "Disabled"}\n- Active Bits: ${personaState.activeBits.join(", ") || "none"}\n- Intensity: ${personaState.vibeIntensity}/5\n- Tempo: ${personaState.tempo}`
      : "";
    const proposalLog = input.proposals?.length
      ? `\nSTRATEGIC PROPOSALS (From Director):\n${input.proposals.map((p) => `- [ID: ${p.id}] Priority: ${p.priority} | Source: ${p.intent.metadata?.source || "unknown"} | Suggested: ${p.intent.text}`).join("\n")}`
      : "";

    const prompt = [
      this.persona,
      "You are the Live Responder. Compose the final spoken response using the executed tool results.",
      directiveBlock,
      personaBlock,
      `Initial router decision: ${input.initialDecision.action} / ${input.initialDecision.reason}`,
      `Initial draft script:\n${input.initialDecision.script || "(none)"}`,
      `Tool results:\n${toolBlock}`,
      `What you just said (DO NOT REPEAT):\n${input.recentSpeech.join("\n") || "(Silent)"}`,
      `Current Emotion: ${input.currentEmotion}`,
      proposalLog,
      `LATEST CHAT BATCH:\n${batchLog}`,
      "Hard rule: final script must be grounded in the latest chat batch and any consumed proposals.",
      "Hard rule: If you weave a Strategic Proposal's content into your script, include its ID in 'consumedProposalIds'.",
      "Return a short natural Simplified Chinese script. If the tools prove there is nothing useful to say, choose drop_noise.",
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.context.llm.generateJson(
      prompt,
      "live_tool_composition",
      (raw) => {
        const v = asRecord(raw);
        return {
          action: enumValue(
            v.action,
            ["respond_to_crowd", "respond_to_specific", "drop_noise", "generate_topic"] as const,
            input.initialDecision.action,
          ),
          emotion: enumValue(
            v.emotion,
            ["neutral", "happy", "laughing", "sad", "surprised", "thinking", "teasing"] as const,
            input.initialDecision.emotion,
          ) as LiveEmotion,
          intensity: typeof v.intensity === "number" ? v.intensity : input.initialDecision.intensity,
          script: sanitizeExternalText(String(v.script || input.initialDecision.script || "")),
          reason: String(v.reason || "tool_composed"),
          toolPlan: undefined,
          consumedProposalIds: Array.isArray(v.consumedProposalIds)
            ? v.consumedProposalIds.map(String)
            : input.initialDecision.consumedProposalIds,
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
      },
    );
  }

  // === Cleaning & Filtering Helpers ===
  private cleanMemoryBlock(
    value: string | null | undefined,
    batch: NormalizedLiveEvent[],
    personaState?: PersonaState,
  ): string | undefined {
    if (!value) return undefined;
    const { allowCatBit, allowSnackBit } = detectActiveBits(batch, personaState);
    const lines = value.split(/\r?\n/).filter((line) => {
      if (!allowCatBit && /猫娘|猫口吻|喵|meow|nya|catgirl/i.test(line)) return false;
      if (!allowSnackBit && /snack|零食|猫粮|snack crime|snack detective|snack confession/i.test(line)) return false;
      return true;
    });
    const cleaned = lines.join("\n").trim();
    return cleaned || undefined;
  }
}

// === Utility Helpers ===
function detectActiveBits(
  batch: NormalizedLiveEvent[],
  personaState?: PersonaState,
): { allowCatBit: boolean; allowSnackBit: boolean } {
  const latestText = batch.map((e) => e.text).join("\n");
  const catInText = /猫娘|喵|猫口吻|猫的口吻|扮猫|catgirl|meow|nya/i.test(latestText);
  const snackInText = /零食|小吃|猫粮|snack|薯片|饼干|夜宵/i.test(latestText);

  return {
    allowCatBit: catInText || (personaState?.activeBits.includes("cat_bit") ?? false),
    allowSnackBit: snackInText || (personaState?.activeBits.includes("snack_detective") ?? false),
  };
}

function formatRelationshipSummary(summary: ViewerProfileSummary): string {
  const name = summary.displayName ?? summary.viewerId;
  const recent = summary.recentMessages?.length ? ` Recent: ${summary.recentMessages.join(" / ")}` : "";
  const roles = summary.roles?.length ? ` Roles: ${summary.roles.join(", ")}` : "";
  return `- ${name} (${summary.platform}): ${summary.relationshipHint}.${roles}${recent}`;
}

function formatPolicy(p: BehaviorPolicyOverlay): string {
  const parts = [];
  if (p.replyBias) parts.push(`Reply Bias: ${p.replyBias}`);
  if (p.vibeIntensity) parts.push(`Vibe Intensity: ${p.vibeIntensity}/5`);
  if (p.focusTopic) parts.push(`Current Focus: ${p.focusTopic}`);
  if (p.instruction) parts.push(`Instruction: ${p.instruction}`);
  return `- ${parts.join(" | ")}`;
}

function filterLivePolicies(
  policies: BehaviorPolicyOverlay[],
  batch: NormalizedLiveEvent[],
  personaState?: PersonaState,
): BehaviorPolicyOverlay[] {
  const { allowCatBit, allowSnackBit } = detectActiveBits(batch, personaState);
  return policies.filter((policy) => {
    const text = [policy.instruction, policy.focusTopic].filter(Boolean).join("\n");
    if (!allowCatBit && /猫娘|猫口吻|喵|meow|nya|catgirl/i.test(text)) return false;
    if (!allowSnackBit && /snack|零食|猫粮|snack crime|snack detective|snack confession/i.test(text)) return false;
    return true;
  });
}

function repairSilentDecision(decision: LiveBatchDecision, batch: NormalizedLiveEvent[]): LiveBatchDecision {
  if (decision.action !== "drop_noise") return decision;
  const addressable = [...batch].reverse().find((event) => {
    const text = event.text.trim();
    return (
      Boolean(text) &&
      (event.metadata?.intent === "question" ||
        event.metadata?.intent === "greeting" ||
        /[?？吗呢]|能看到|在吗|你好|hello|hi|早|午|晚|来了/i.test(text))
    );
  });
  if (!addressable) return decision;
  const name = addressable.user?.name ?? "这位观众";
  return {
    ...decision,
    action: "respond_to_specific",
    emotion: decision.emotion || "neutral",
    intensity: Math.max(decision.intensity || 1, 2),
    script: `${name}，能看到，你这条弹幕进来了。`,
    reason: `repaired addressable danmaku: ${decision.reason}`,
  };
}
