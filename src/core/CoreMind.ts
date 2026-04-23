import type {
  AttachmentState,
  CoreMindConfig,
  CoreMindDecisionRecord,
  CoreMindIdentity,
  CoreMindToolView,
  CursorContextSnapshot,
  DeliberationState,
  ToolExecutionContext,
  ToolResult,
} from "../types.js";
import { AsyncConfigStore } from "../config/AsyncConfigStore.js";
import { MemoryAuditSink, ToolRegistry } from "../tools/ToolRegistry.js";
import { CursorRegistry } from "./CursorRegistry.js";
import { transferContext } from "./ContextTransfer.js";

function now(): number {
  return Date.now();
}

export class CoreMind {
  readonly identity: CoreMindIdentity;
  readonly decisions: CoreMindDecisionRecord[] = [];
  readonly audit = new MemoryAuditSink();
  readonly continuity = {
    recentCursorIds: [] as string[],
    activeGoals: [],
    pendingQuestions: [],
    recentSnapshots: [] as CursorContextSnapshot[],
    privacyMemories: [],
    selfSummary: "Stelle is a Core Mind attached to cursors, defaulting to Inner Cursor.",
  };

  attachment: AttachmentState;
  deliberation: DeliberationState = {
    focus: "initialization",
    confidence: 0.8,
    risk: "low",
  };

  constructor(
    readonly cursors: CursorRegistry,
    readonly tools: ToolRegistry,
    private config: CoreMindConfig,
    private readonly configStore?: AsyncConfigStore<CoreMindConfig>
  ) {
    this.identity = { id: config.coreMindId, name: "Stelle", version: config.version };
    this.attachment = {
      currentCursorId: config.defaultCursorId,
      mode: "detached",
      attachedAt: now(),
      reason: "constructed",
    };
  }

  static async create(options: {
    cursors: CursorRegistry;
    tools: ToolRegistry;
    defaultCursorId: string;
    configStore?: AsyncConfigStore<CoreMindConfig>;
  }): Promise<CoreMind> {
    const core = new CoreMind(
      options.cursors,
      options.tools,
      {
        coreMindId: "stelle-core",
        version: "0.1.0",
        defaultCursorId: options.defaultCursorId,
        behavior: {},
        continuity: {},
        toolPolicy: {},
        updatedAt: now(),
      },
      options.configStore
    );
    await core.attachToCursor(options.defaultCursorId, "initial attach");
    return core;
  }

  get toolView(): CoreMindToolView {
    const current = this.cursors.get(this.attachment.currentCursorId);
    const cursorToolNames = new Set(
      current?.getToolNamespace().tools.map((tool) => `${tool.namespace}.${tool.name}`) ?? []
    );
    return {
      cursorTools: this.tools.list({ authorityClass: "cursor" }).filter((tool) =>
        cursorToolNames.has(`${tool.namespace}.${tool.name}`)
      ),
      stelleTools: this.tools.list({ authorityClass: "stelle" }),
    };
  }

  async attachToCursor(cursorId: string, reason: string): Promise<void> {
    const target = this.cursors.get(cursorId);
    if (!target) {
      throw new Error(`Cannot attach missing cursor: ${cursorId}`);
    }
    const namespace = target.getToolNamespace();
    const context = transferContext({
      targetCursorId: cursorId,
      reason,
      targetToolNamespaces: namespace.namespaces,
    });
    await target.attach(context);
    this.attachment = {
      currentCursorId: cursorId,
      mode: target.identity.kind === "inner" ? "inner" : "attached",
      attachedAt: now(),
      reason,
    };
    this.recordDecision("attach", `Attached to ${cursorId}`, cursorId, reason, "low");
  }

  async switchCursor(cursorId: string, reason: string): Promise<void> {
    const previousCursorId = this.attachment.currentCursorId;
    const current = this.cursors.get(previousCursorId);
    const target = this.cursors.get(cursorId);
    if (!target) {
      throw new Error(`Cannot switch to missing cursor: ${cursorId}`);
    }

    this.attachment = { ...this.attachment, mode: "switching", reason };
    const snapshot = current ? await current.detach(reason) : undefined;
    if (snapshot) {
      this.continuity.recentSnapshots.push(snapshot);
      this.continuity.recentCursorIds.push(snapshot.cursorId);
    }

    const context = transferContext({
      from: snapshot,
      targetCursorId: cursorId,
      reason,
      targetToolNamespaces: target.getToolNamespace().namespaces,
    });
    await target.attach(context);
    this.attachment = {
      currentCursorId: cursorId,
      previousCursorId,
      mode: target.identity.kind === "inner" ? "inner" : "attached",
      attachedAt: now(),
      reason,
    };
    this.recordDecision("switch_cursor", `Switched from ${previousCursorId} to ${cursorId}`, cursorId, reason, "low");
  }

  async returnToInnerCursor(reason = "return to inner cursor"): Promise<void> {
    await this.switchCursor(this.config.defaultCursorId, reason);
  }

  async observeCurrentCursor() {
    const cursor = this.cursors.get(this.attachment.currentCursorId);
    if (!cursor) throw new Error(`Current cursor missing: ${this.attachment.currentCursorId}`);
    return cursor.observe();
  }

  deliberate(focus: string): DeliberationState {
    this.deliberation = {
      focus,
      confidence: 0.7,
      risk: "low",
      nextAction: { type: "observe", summary: "Observe current cursor before acting." },
    };
    return this.deliberation;
  }

  async useTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const context: ToolExecutionContext = {
      caller: "stelle",
      cursorId: this.attachment.currentCursorId,
      authority: {
        caller: "stelle",
        allowedAuthorityClasses: ["cursor", "stelle"],
      },
      audit: this.audit,
    };
    const result = await this.tools.execute(name, input, context);
    this.recordDecision("use_tool", `Used tool ${name}: ${result.summary}`, this.attachment.currentCursorId, "tool call", "low", name);
    return result;
  }

  handleEscalation(summary: string): CoreMindDecisionRecord {
    return this.recordDecision("escalation", summary, this.attachment.currentCursorId, "cursor escalation", "medium");
  }

  handleRecall(summary: string): CoreMindDecisionRecord {
    return this.recordDecision("recall", summary, this.attachment.currentCursorId, "cursor recall", "medium");
  }

  async updateCoreMindConfig(patch: Partial<CoreMindConfig>, reason: string): Promise<CoreMindDecisionRecord> {
    this.config = {
      ...this.config,
      ...patch,
      behavior: { ...this.config.behavior, ...patch.behavior },
      continuity: { ...this.config.continuity, ...patch.continuity },
      toolPolicy: { ...this.config.toolPolicy, ...patch.toolPolicy },
      updatedAt: now(),
    };
    void this.saveConfigAsync().catch((error: unknown) => {
      this.recordDecision(
        "config_save_failed",
        `Core Mind config save failed: ${error instanceof Error ? error.message : String(error)}`,
        this.attachment.currentCursorId,
        "async config save",
        "medium"
      );
    });
    return this.recordDecision("config_changed", `Core Mind config changed: ${reason}`, this.attachment.currentCursorId, reason, "low");
  }

  async saveConfigAsync(): Promise<void> {
    await this.configStore?.save(this.config);
  }

  private recordDecision(
    type: string,
    summary: string,
    cursorId: string,
    reason: string,
    risk: "low" | "medium" | "high",
    toolName?: string
  ): CoreMindDecisionRecord {
    const record: CoreMindDecisionRecord = {
      id: `decision-${now()}-${Math.random().toString(36).slice(2)}`,
      type,
      summary,
      cursorId,
      toolName,
      reason,
      risk,
      timestamp: now(),
    };
    this.decisions.push(record);
    return record;
  }
}
