import { z } from "zod";
import type { CognitiveContext, CandidateIntent } from "./schemas.js";
import { CandidateIntentSchema } from "./schemas.js";
import type { LlmClient } from "../model/llm.js";

const VALID_SCOPES = new Set<CandidateIntent["scope"]>(["reply", "world", "stage", "memory", "tool"]);

/**
 * 意图生成器 (Intent Generator)
 * 核心认知逻辑，根据上下文产生候选意图。
 */
export class IntentGenerator {
  constructor(private readonly llm?: LlmClient) {}

  /**
   * 生成候选意图
   */
  public async generate(ctx: CognitiveContext): Promise<CandidateIntent[]> {
    const prompt = `
You are the cognitive engine of Stelle, an AI agent.
Based on the current observations, memories, and world state, generate a list of Candidate Intents for your next actions.

### Context:
- Lane: ${ctx.lane}
- Observations: ${JSON.stringify(ctx.observations)}
- Retrieved Memories: ${JSON.stringify(ctx.memoryHits)}
- World View: ${JSON.stringify(ctx.worldView)}

### Requirements:
1. Generate 2-4 distinct Candidate Intents.
2. Each intent must have a scope: "reply", "world", "stage", "memory", or "tool".
3. Provide a clear justification based on the evidence provided.
4. Ensure the desiredOutcome describes the state change you want to achieve.

### Output Format:
Return ONLY a JSON array. Every object must include exactly these required keys:
- intentId: unique string, e.g. "${ctx.cycleId}-reply-1"
- actorId: "${ctx.agentId}"
- scope: "reply" | "world" | "stage" | "memory" | "tool"
- summary: short action summary
- desiredOutcome: expected state change
- evidenceRefs: array of evidence references, e.g. [{"kind":"event","uri":"user-msg-001"}]
- justification: one-sentence reason

Optional executable fields:
- For scope "reply" or "stage", include replyText: the exact short text Stelle should output.
- For scope "memory", include memorySummary: the exact memory to write.
- For scope "world", include actionProposal with one of these shapes:
  {"type":"UPDATE_ENTITY_STATE","actorId":"${ctx.agentId}","payload":{"entityId":"<existing entity id>","patch":{...}}}
  {"type":"MOVE_ENTITY","actorId":"${ctx.agentId}","payload":{"entityId":"<existing entity id>","newLocation":{"sceneId":"default_room","parentId":"<existing parent id>"}}}
Only reference entity IDs visible in World View.
`;

    try {
      if (!this.llm) throw new Error("LLM client is not configured");
      const intents = await this.llm.generateJson<CandidateIntent[]>(
        prompt,
        "CandidateIntent[]",
        (raw) => {
          const items: unknown[] = Array.isArray(raw)
            ? raw
            : Array.isArray((raw as any)?.intents)
              ? (raw as any).intents
              : Array.isArray((raw as any)?.candidateIntents)
                ? (raw as any).candidateIntents
                : (() => {
                    throw new Error("Expected array of intents");
                  })();

          return items.map((item, index) => CandidateIntentSchema.parse(this.normalizeIntent(item, ctx, index)));
        },
        { role: "primary", temperature: 0.7 }
      );
      return intents;
    } catch (error) {
      console.error("[IntentGenerator] LLM failed to generate intents, falling back to basic reply.", error);
      return [{
        intentId: `fallback-reply-${ctx.cycleId}`,
        actorId: ctx.agentId,
        scope: "reply",
        summary: "Standard reply due to cognitive failure",
        desiredOutcome: "User receives a basic response",
        evidenceRefs: [],
        justification: "System fallback triggered."
      }];
    }
  }

  private normalizeIntent(raw: unknown, ctx: CognitiveContext, index: number): CandidateIntent {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const intentId = coerceString(item.intentId ?? item.id, `${ctx.cycleId}-intent-${index + 1}`);
    const scope = coerceScope(item.scope);
    const summary = coerceString(
      item.summary ?? item.intent ?? item.action ?? item.description,
      `Respond thoughtfully to the latest ${ctx.lane} observation`,
    );
    const desiredOutcome = coerceString(
      item.desiredOutcome ?? item.outcome ?? item.goal,
      "The user receives a helpful, grounded response.",
    );
    const evidenceRefs = Array.isArray(item.evidenceRefs)
      ? item.evidenceRefs
      : ctx.observations.map((observation: any) => ({
          kind: "event",
          uri: observation.id ?? `${ctx.cycleId}-observation`,
          summary: observation.payload?.text,
        }));

    return {
      intentId,
      actorId: coerceString(item.actorId, ctx.agentId),
      scope,
      summary,
      desiredOutcome,
      targetRefs: Array.isArray(item.targetRefs) ? item.targetRefs : undefined,
      requiredAffordanceHints: Array.isArray(item.requiredAffordanceHints)
        ? item.requiredAffordanceHints.map((hint) => String(hint))
        : undefined,
      actionProposal: item.actionProposal ?? item.worldAction ?? createDefaultActionProposal(scope, item, ctx),
      replyText: typeof item.replyText === "string" ? item.replyText : undefined,
      memorySummary: typeof item.memorySummary === "string" ? item.memorySummary : undefined,
      evidenceRefs,
      justification: coerceString(item.justification ?? item.reason, "Generated from the current cognitive context."),
    };
  }
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function coerceScope(value: unknown): CandidateIntent["scope"] {
  return typeof value === "string" && VALID_SCOPES.has(value as CandidateIntent["scope"])
    ? (value as CandidateIntent["scope"])
    : "reply";
}

function createDefaultActionProposal(
  scope: CandidateIntent["scope"],
  item: Record<string, unknown>,
  ctx: CognitiveContext,
): unknown {
  if (scope !== "world") return undefined;

  const entities = asRecord(asRecord(ctx.worldView).worldState).entities;
  const roomId = findEntityId(entities, "room") ?? "room-studio";
  const characterId = findEntityId(entities, "character") ?? ctx.agentId;
  const summary = coerceString(item.summary ?? item.intent ?? item.action ?? item.description, "").toLowerCase();

  if (summary.includes("clean") || summary.includes("calm") || summary.includes("quiet") || summary.includes("room")) {
    return {
      type: "UPDATE_ENTITY_STATE",
      actorId: ctx.agentId,
      payload: { entityId: roomId, patch: { cleanliness: 7 } },
    };
  }

  return {
    type: "UPDATE_ENTITY_STATE",
    actorId: ctx.agentId,
    payload: { entityId: characterId, patch: { mood: "attentive" } },
  };
}

function findEntityId(entities: unknown, kind: string): string | undefined {
  const record = asRecord(entities);
  for (const [id, entity] of Object.entries(record)) {
    if (asRecord(entity).kind === kind) return id;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

