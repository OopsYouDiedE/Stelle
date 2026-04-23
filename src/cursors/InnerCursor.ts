import type { ContextStreamItem, CursorConfig, CursorPolicy, CursorToolNamespace } from "../types.js";
import { AsyncConfigStore } from "../config/AsyncConfigStore.js";
import { BaseCursor } from "./BaseCursor.js";

function now(): number {
  return Date.now();
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
