import type { StelleEventBus } from "../../core/event/event_bus.js";
import type { InteractionPolicyApi } from "../../capabilities/interaction_policy/api.js";
import type { CandidateIntent } from "../../capabilities/interaction_policy/intent_filter.js";

export interface InternalInteractionOptions {
  eventBus: StelleEventBus;
  interactionPolicy: InteractionPolicyApi;
}

/**
 * 内部交互窗口 (Internal Interaction Window)
 * 负责意图过滤和动作执行。
 */
export class InternalInteractionWindow {
  private readonly intentsByCycle = new Map<string, CandidateIntent[]>();

  constructor(private readonly options: InternalInteractionOptions) {
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    // 监听候选意图生成
    this.options.eventBus.subscribe("cognition.intent.generated", async (event) => {
      const { intents } = event.payload as any;
      const affordances = await this.options.interactionPolicy.resolve_affordances({});
      const filtered = await this.options.interactionPolicy.filter_intents(intents, affordances);
      
      const executables = filtered.filter(f => f.status === "executable");
      if (event.cycleId) {
        this.intentsByCycle.set(event.cycleId, executables.map((result) => result.intent));
      }

      this.options.eventBus.publish({
        type: "interaction.intent.filter.completed",
        source: "window.internal_interaction",
        cycleId: event.cycleId,
        correlationId: event.correlationId,
        payload: executables,
      });
    });

    // 监听最终决策选择，执行动作
    this.options.eventBus.subscribe("cognition.decision.selected", async (event) => {
      const { selection } = event.payload as any;
      await this.executeAction(selection, event.cycleId!, event.correlationId!);
    });
  }

  private async executeAction(selection: any, cycleId: string, correlationId: string): Promise<void> {
    const intent = this.intentsByCycle.get(cycleId)?.find((candidate) => candidate.intentId === selection.selectedIntentId);
    console.log(`[InteractionWindow] Executing action for intent: ${selection.selectedIntentId}`);

    const outcome = intent
      ? await this.executeIntent(intent, cycleId, correlationId)
      : {
          status: "failed",
          actionId: `act-${Date.now()}`,
          intentId: selection.selectedIntentId,
          error: "Selected intent was not found in executable cache.",
        };

    // 发布动作执行完成事件
    this.options.eventBus.publish({
      type: "interaction.action.outcome.committed",
      source: "window.internal_interaction",
      cycleId,
      correlationId,
      payload: outcome,
    });

    this.intentsByCycle.delete(cycleId);
  }

  private async executeIntent(intent: CandidateIntent, cycleId: string, correlationId: string): Promise<Record<string, unknown>> {
    switch (intent.scope) {
      case "world":
        return this.executeWorldIntent(intent, cycleId, correlationId);
      case "memory":
        return this.executeMemoryIntent(intent);
      case "stage":
      case "reply":
        return this.executeReplyIntent(intent, cycleId, correlationId);
      default:
        return {
          status: "failed",
          actionId: `act-${Date.now()}`,
          intentId: intent.intentId,
          error: `Unsupported intent scope: ${intent.scope}`,
        };
    }
  }

  private async executeReplyIntent(
    intent: CandidateIntent,
    cycleId: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const text = normalizeText(intent.replyText || intent.summary || intent.desiredOutcome);
    const actionId = `act-${Date.now()}`;

    this.options.eventBus.publish({
      type: "cognition.intent",
      source: "window.internal_interaction",
      cycleId,
      correlationId,
      payload: {
        id: `respond-${intent.intentId}`,
        type: "respond",
        sourcePackageId: "window.internal_interaction",
        targetCapability: "expression.stage_output",
        priority: 50,
        createdAt: Date.now(),
        reason: intent.justification,
        sourceEventIds: intent.evidenceRefs.map((ref: any) => String(ref.uri ?? ref.id ?? "")),
        payload: {
          text,
          lane: "direct_response",
          salience: "medium",
          ttlMs: 30_000,
          interrupt: "soft",
          output: { caption: true, tts: false },
        },
      },
    });

    this.options.eventBus.publish({
      type: "interaction.reply.sent",
      source: "window.internal_interaction",
      cycleId,
      correlationId,
      payload: { actionId, intentId: intent.intentId, text },
    });

    return {
      status: "success",
      actionId,
      intentId: intent.intentId,
      kind: "reply",
      text,
    };
  }

  private async executeWorldIntent(
    intent: CandidateIntent,
    cycleId: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const actionId = `act-${Date.now()}`;
    const proposal = normalizeWorldProposal(intent);
    const result = await this.waitForWorldAction(cycleId, correlationId, proposal);

    this.options.eventBus.publish({
      type: "interaction.world.applied",
      source: "window.internal_interaction",
      cycleId,
      correlationId,
      payload: { actionId, intentId: intent.intentId, proposal, result },
    });

    return {
      status: result?.success ? "success" : "failed",
      actionId,
      intentId: intent.intentId,
      kind: "world",
      proposal,
      result,
      error: result?.success ? undefined : result?.error ?? "World action did not complete.",
    };
  }

  private executeMemoryIntent(intent: CandidateIntent): Record<string, unknown> {
    return {
      status: "success",
      actionId: `act-${Date.now()}`,
      intentId: intent.intentId,
      kind: "memory",
      memoryEntry: {
        summary: normalizeText(intent.memorySummary || intent.summary),
        detail: intent.justification,
        scope: "session",
        kind: "episode",
        importance: 6,
        evidenceRefs: intent.evidenceRefs,
      },
    };
  }

  private waitForWorldAction(
    cycleId: string,
    correlationId: string,
    proposal: Record<string, unknown>,
  ): Promise<any> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        resolve({ success: false, error: "Timed out waiting for world.action.completed" });
      }, 2000);

      const unsubscribe = this.options.eventBus.subscribe("world.action.completed", (event) => {
        if (event.cycleId !== cycleId) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve(event.payload);
      });

      this.options.eventBus.publish({
        type: "world.action.propose",
        source: "window.internal_interaction",
        cycleId,
        correlationId,
        payload: proposal,
      });
    });
  }
}

function normalizeWorldProposal(intent: CandidateIntent): Record<string, unknown> {
  const proposal = asRecord(intent.actionProposal);
  if (Object.keys(proposal).length === 0) {
    const summary = `${intent.summary} ${intent.desiredOutcome} ${intent.justification}`.toLowerCase();
    if (summary.includes("void") || summary.includes("non-existent") || summary.includes("nonexistent")) {
      return {
        type: "MOVE_ENTITY",
        actorId: intent.actorId,
        payload: {
          entityId: firstTargetId(intent) ?? "coffee-cup",
          newLocation: { sceneId: "stelle_room", parentId: "the-void" },
        },
      };
    }
  }

  const type = typeof proposal.type === "string" ? proposal.type : "UPDATE_ENTITY_STATE";
  const payload = asRecord(proposal.payload);

  if (type === "MOVE_ENTITY") {
    return {
      type,
      actorId: typeof proposal.actorId === "string" ? proposal.actorId : intent.actorId,
      payload: {
        entityId: String(payload.entityId ?? firstTargetId(intent) ?? "character-stelle"),
        newLocation: asRecord(payload.newLocation),
      },
    };
  }

  if (type === "CREATE_ENTITY") {
    return {
      type,
      actorId: typeof proposal.actorId === "string" ? proposal.actorId : intent.actorId,
      payload,
    };
  }

  return {
    type: "UPDATE_ENTITY_STATE",
    actorId: typeof proposal.actorId === "string" ? proposal.actorId : intent.actorId,
    payload: {
      entityId: String(payload.entityId ?? firstTargetId(intent) ?? "character-stelle"),
      patch: Object.keys(asRecord(payload.patch)).length > 0 ? asRecord(payload.patch) : { mood: "attentive" },
    },
  };
}

function firstTargetId(intent: CandidateIntent): string | undefined {
  const target = intent.targetRefs?.[0];
  const record = asRecord(target);
  const id = record.id ?? record.entityId ?? record.uri;
  return typeof id === "string" ? id : undefined;
}

function normalizeText(value: string): string {
  return value.trim().slice(0, 500) || "I'm here with you.";
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}
