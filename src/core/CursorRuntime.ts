import type {
  ContextStreamItem,
  CursorAttachResult,
  CursorObservation,
  CursorReport,
  CursorState,
  CursorToolNamespace,
  ToolResult,
} from "../types.js";
import { MemoryAuditSink, ToolRegistry } from "../tools/ToolRegistry.js";
import { CursorRegistry } from "./CursorRegistry.js";
import { transferContext } from "./ContextTransfer.js";

function now(): number {
  return Date.now();
}

export interface CursorRuntimeSnapshot {
  cursors: {
    cursorId: string;
    kind: string;
    state: CursorState;
    tools: CursorToolNamespace;
  }[];
  pendingReports: CursorReport[];
  auditRecordCount: number;
}

export class CursorRuntime {
  readonly audit = new MemoryAuditSink();
  private readonly reports: CursorReport[] = [];

  constructor(readonly cursors: CursorRegistry, readonly tools: ToolRegistry) {}

  async startCursor(cursorId: string, reason = "cursor runtime start"): Promise<CursorAttachResult> {
    const cursor = this.requireCursor(cursorId);
    const context = transferContext({
      targetCursorId: cursorId,
      reason,
      targetToolNamespaces: cursor.getToolNamespace().namespaces,
    });
    const result = await cursor.attach(context);
    this.pushReport({
      id: `runtime-start-${cursorId}-${now()}`,
      cursorId,
      type: "runtime_start",
      severity: "info",
      summary: `Cursor runtime started ${cursorId}.`,
      needsAttention: false,
      timestamp: now(),
    });
    return result;
  }

  async stopCursor(cursorId: string, reason = "cursor runtime stop") {
    const cursor = this.requireCursor(cursorId);
    const snapshot = await cursor.detach(reason);
    this.pushReport({
      id: `runtime-stop-${cursorId}-${now()}`,
      cursorId,
      type: "runtime_stop",
      severity: "info",
      summary: `Cursor runtime stopped ${cursorId}.`,
      needsAttention: false,
      timestamp: now(),
    });
    return snapshot;
  }

  async observe(cursorId: string): Promise<CursorObservation> {
    return this.requireCursor(cursorId).observe();
  }

  async sendInput(
    cursorId: string,
    input: Omit<ContextStreamItem, "id" | "timestamp" | "source" | "trust"> & {
      id?: string;
      timestamp?: number;
      source?: string;
      trust?: ContextStreamItem["trust"];
    }
  ): Promise<CursorReport[]> {
    const cursor = this.requireCursor(cursorId);
    if (!cursor.policy.allowPassiveResponse || !cursor.passiveRespond) {
      const report: CursorReport = {
        id: `runtime-input-denied-${cursorId}-${now()}`,
        cursorId,
        type: "passive_response_unavailable",
        severity: "notice",
        summary: `Cursor ${cursorId} does not allow passive response.`,
        needsAttention: false,
        timestamp: now(),
      };
      this.pushReport(report);
      return [report];
    }

    const event: ContextStreamItem = {
      id: input.id ?? `input-${cursorId}-${now()}`,
      type: input.type,
      source: input.source ?? "cursor_runtime",
      timestamp: input.timestamp ?? now(),
      content: input.content,
      resourceRef: input.resourceRef,
      trust: input.trust ?? "external",
      metadata: input.metadata,
    };
    const reports = await cursor.passiveRespond(event);
    this.pushReports(reports);
    return reports;
  }

  async tick(cursorId: string): Promise<CursorReport[]> {
    const cursor = this.requireCursor(cursorId);
    if (!cursor.policy.allowBackgroundTick || !cursor.tick) {
      const report: CursorReport = {
        id: `runtime-tick-skipped-${cursorId}-${now()}`,
        cursorId,
        type: "tick_skipped",
        severity: "debug",
        summary: `Cursor ${cursorId} has no allowed background tick.`,
        needsAttention: false,
        timestamp: now(),
      };
      this.pushReport(report);
      return [report];
    }
    const reports = await cursor.tick();
    this.pushReports(reports);
    return reports;
  }

  async useCursorTool(
    cursorId: string,
    toolFullName: string,
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    const cursor = this.requireCursor(cursorId);
    const namespace = cursor.getToolNamespace();
    const allowed = namespace.tools.some((tool) => `${tool.namespace}.${tool.name}` === toolFullName);
    if (!allowed) {
      return {
        ok: false,
        summary: `Tool ${toolFullName} is not exposed by cursor ${cursorId}.`,
        error: {
          code: "tool_not_exposed_by_cursor",
          message: `Tool ${toolFullName} is not exposed by cursor ${cursorId}.`,
          retryable: false,
        },
      };
    }

    const tool = this.tools.get(toolFullName);
    if (!tool) {
      return {
        ok: false,
        summary: `Tool is not registered: ${toolFullName}.`,
        error: {
          code: "tool_not_found",
          message: `Tool is not registered: ${toolFullName}.`,
          retryable: false,
        },
      };
    }

    const externalWrite =
      tool.sideEffects.externalVisible ||
      tool.authority.level === "external_write" ||
      tool.authority.level === "admin";
    if (externalWrite && (!cursor.policy.allowPassiveResponse || cursor.policy.passiveResponseRisk === "none")) {
      return {
        ok: false,
        summary: `Cursor ${cursorId} policy does not allow externally visible passive tool use.`,
        error: {
          code: "cursor_policy_denied",
          message: `Cursor ${cursorId} policy does not allow externally visible passive tool use.`,
          retryable: false,
        },
      };
    }

    return this.tools.execute(toolFullName, input, {
      caller: "cursor",
      cursorId,
      authority: {
        caller: "cursor",
        allowedAuthorityClasses: ["cursor"],
      },
      audit: this.audit,
    });
  }

  drainReports(): CursorReport[] {
    return this.reports.splice(0, this.reports.length);
  }

  snapshot(): CursorRuntimeSnapshot {
    return {
      cursors: this.cursors.list().map((cursor) => ({
        cursorId: cursor.identity.id,
        kind: cursor.identity.kind,
        state: cursor.getState(),
        tools: cursor.getToolNamespace(),
      })),
      pendingReports: [...this.reports],
      auditRecordCount: this.audit.records.length,
    };
  }

  private requireCursor(cursorId: string) {
    const cursor = this.cursors.get(cursorId);
    if (!cursor) {
      throw new Error(`Cursor not registered: ${cursorId}`);
    }
    return cursor;
  }

  private pushReports(reports: CursorReport[]): void {
    for (const report of reports) {
      this.pushReport(report);
    }
  }

  private pushReport(report: CursorReport): void {
    this.reports.push(report);
  }
}
