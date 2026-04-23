import type {
  ContextStreamItem,
  CursorConfig,
  CursorPolicy,
  CursorReport,
  CursorToolNamespace,
} from "../types.js";
import { AsyncConfigStore } from "../config/AsyncConfigStore.js";
import { BaseCursor } from "./BaseCursor.js";

function now(): number {
  return Date.now();
}

const testPolicy: CursorPolicy = {
  allowPassiveResponse: true,
  allowBackgroundTick: false,
  allowInitiativeWhenAttached: false,
  passiveResponseRisk: "low",
  escalationRules: [
    {
      id: "test.high_risk",
      summary: "Escalate inputs marked as high risk.",
      severity: "warning",
    },
  ],
};

export class TestCursor extends BaseCursor {
  constructor(options?: { id?: string; configStore?: AsyncConfigStore<CursorConfig> }) {
    const id = options?.id ?? "test";
    super(
      { id, kind: "test", displayName: "Test Cursor", version: "0.1.0" },
      testPolicy,
      {
        cursorId: id,
        version: "0.1.0",
        behavior: { replyStyle: "minimal" },
        runtime: {},
        permissions: { externalVisibleActions: false },
        updatedAt: now(),
      },
      options?.configStore
    );
    this.stream.push(this.event("Test Cursor initialized."));
  }

  getToolNamespace(): CursorToolNamespace {
    return {
      cursorId: this.identity.id,
      namespaces: ["test"],
      tools: [
        {
          namespace: "test",
          name: "echo",
          authorityClass: "cursor",
          summary: "Echo low-risk text for tests.",
          authorityHint: "read-only cursor tool",
        },
      ],
    };
  }

  async passiveRespond(input: ContextStreamItem): Promise<CursorReport[]> {
    if (input.metadata?.risk === "high") {
      return [this.report("escalation", "warning", "Input exceeds Test Cursor passive boundary.", true)];
    }
    this.stream.push(this.event(`Passive input: ${input.content ?? input.type}`));
    return [this.report("passive_response", "info", "Test Cursor accepted passive input.", false)];
  }

  private event(content: string): ContextStreamItem {
    return {
      id: `${this.identity.id}-event-${now()}`,
      type: "event",
      source: this.identity.id,
      timestamp: now(),
      content,
      trust: "cursor",
    };
  }
}
