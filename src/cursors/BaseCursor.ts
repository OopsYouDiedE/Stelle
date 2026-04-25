import type {
  ContextStreamItem,
  CursorAttachContext,
  CursorAttachResult,
  CursorConfig,
  CursorContextSnapshot,
  CursorHost,
  CursorIdentity,
  CursorObservation,
  CursorPendingItem,
  CursorPolicy,
  CursorReport,
  CursorState,
  CursorToolNamespace,
  ResourceReference,
} from "../types.js";
import { AsyncConfigStore } from "../StelleConfig.js";

function now(): number {
  return Date.now();
}

export abstract class BaseCursor implements CursorHost {
  protected state: CursorState;
  protected stream: ContextStreamItem[] = [];
  protected pendingItems: CursorPendingItem[] = [];
  protected resourceRefs: ResourceReference[] = [];

  protected constructor(
    readonly identity: CursorIdentity,
    readonly policy: CursorPolicy,
    protected config: CursorConfig,
    private readonly configStore?: AsyncConfigStore<CursorConfig>
  ) {
    this.state = {
      cursorId: identity.id,
      status: "idle",
      attached: false,
      summary: `${identity.kind} cursor is idle.`,
    };
  }

  getState(): CursorState {
    return { ...this.state };
  }

  abstract getToolNamespace(): CursorToolNamespace;

  async attach(context: CursorAttachContext): Promise<CursorAttachResult> {
    this.state = {
      ...this.state,
      attached: true,
      status: "active",
      summary: `Attached: ${context.reason}`,
      lastObservedAt: now(),
    };
    this.stream.push(...context.transferredStream);
    const observation = await this.observe();
    return {
      state: this.getState(),
      observation,
      tools: this.getToolNamespace(),
    };
  }

  async detach(reason: string): Promise<CursorContextSnapshot> {
    this.state = {
      ...this.state,
      attached: false,
      status: "idle",
      summary: `Detached: ${reason}`,
    };
    return this.snapshot();
  }

  async observe(): Promise<CursorObservation> {
    this.state = { ...this.state, lastObservedAt: now() };
    return {
      cursorId: this.identity.id,
      timestamp: now(),
      stream: [...this.stream.slice(-20)],
      stateSummary: this.state.summary,
    };
  }

  async updateConfig(patch: Partial<CursorConfig>, reason: string): Promise<CursorReport> {
    this.config = {
      ...this.config,
      ...patch,
      behavior: { ...this.config.behavior, ...patch.behavior },
      runtime: { ...this.config.runtime, ...patch.runtime },
      permissions: { ...this.config.permissions, ...patch.permissions },
      updatedAt: now(),
    };
    void this.saveConfigAsync().catch((error: unknown) => {
      this.state = {
        ...this.state,
        status: "error",
        summary: `Config save failed: ${error instanceof Error ? error.message : String(error)}`,
        lastErrorAt: now(),
      };
      this.stream.push({
        id: `config-save-error-${this.identity.id}-${now()}`,
        type: "event",
        source: this.identity.id,
        timestamp: now(),
        content: this.state.summary,
        trust: "cursor",
        metadata: { configSaveFailed: true },
      });
    });
    return this.report("config_changed", "info", `Cursor config changed: ${reason}`, false);
  }

  async saveConfigAsync(): Promise<void> {
    await this.configStore?.save(this.config);
  }

  protected snapshot(): CursorContextSnapshot {
    return {
      cursorId: this.identity.id,
      kind: this.identity.kind,
      timestamp: now(),
      stateSummary: this.state.summary,
      recentStream: [...this.stream.slice(-10)],
      resourceRefs: [...this.resourceRefs],
      pendingItems: [...this.pendingItems],
      safetyNotes: ["Snapshot is summarized and excludes secrets by contract."],
    };
  }

  protected report(
    type: string,
    severity: CursorReport["severity"],
    summary: string,
    needsAttention: boolean,
    payload?: Record<string, unknown>
  ): CursorReport {
    return {
      id: `${this.identity.id}-${type}-${now()}`,
      cursorId: this.identity.id,
      type,
      severity,
      summary,
      payload,
      needsAttention,
      timestamp: now(),
    };
  }
}

const innerPolicy: CursorPolicy = {
  allowPassiveResponse: false,
  allowBackgroundTick: false,
  allowInitiativeWhenAttached: false,
  passiveResponseRisk: "none",
  escalationRules: [],
};

export class InnerCursor extends BaseCursor {
  constructor(options?: { id?: string; configStore?: AsyncConfigStore<CursorConfig> }) {
    const id = options?.id ?? "inner";
    super(
      { id, kind: "inner", displayName: "Inner Cursor", version: "0.1.0" },
      innerPolicy,
      {
        cursorId: id,
        version: "0.1.0",
        behavior: { mode: "reflection" },
        runtime: {},
        permissions: {},
        updatedAt: now(),
      },
      options?.configStore
    );
    this.stream.push(this.note("Inner Cursor ready for reflection, continuity, and planning."));
  }

  getToolNamespace(): CursorToolNamespace {
    return {
      cursorId: this.identity.id,
      namespaces: [],
      tools: [],
    };
  }

  addReflection(summary: string): void {
    this.stream.push(this.note(summary));
  }

  private note(content: string): ContextStreamItem {
    return {
      id: `${this.identity.id}-note-${now()}`,
      type: "summary",
      source: this.identity.id,
      timestamp: now(),
      content,
      trust: "internal",
    };
  }
}
