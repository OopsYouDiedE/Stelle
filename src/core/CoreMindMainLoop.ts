import type { ContextStreamItem, CursorReport } from "../types.js";
import { CoreMind } from "./CoreMind.js";
import { CursorRuntime } from "./CursorRuntime.js";
import { InnerCursor } from "../cursors/InnerCursor.js";

export type MainLoopPhase =
  | "idle_inner"
  | "observing"
  | "deliberating"
  | "acting"
  | "switching"
  | "waiting_confirmation"
  | "degraded"
  | "stopping";

export type MainLoopEvent =
  | { type: "cursor_input"; cursorId: string; input: ContextStreamItem }
  | { type: "cursor_report"; report: CursorReport }
  | { type: "user_command"; command: string; payload?: Record<string, unknown> }
  | { type: "heartbeat"; reason: string }
  | { type: "shutdown"; reason: string };

export interface MainLoopSnapshot {
  running: boolean;
  phase: MainLoopPhase;
  queueLength: number;
  lastReason?: string;
  handledEvents: number;
}

export class CoreMindMainLoop {
  private readonly queue: MainLoopEvent[] = [];
  private running = false;
  private draining = false;
  private phase: MainLoopPhase = "idle_inner";
  private handledEvents = 0;
  private lastReason?: string;

  constructor(
    readonly core: CoreMind,
    readonly runtime: CursorRuntime,
    private readonly innerCursor?: InnerCursor
  ) {}

  start(): void {
    this.running = true;
    this.wake("main loop started");
  }

  async stop(reason = "main loop stopped"): Promise<void> {
    this.phase = "stopping";
    this.running = false;
    this.enqueue({ type: "shutdown", reason });
    await this.drain();
  }

  enqueue(event: MainLoopEvent): void {
    this.queue.push(event);
    if (this.running && !this.draining) {
      void this.drain();
    }
  }

  wake(reason: string): void {
    this.enqueue({ type: "heartbeat", reason });
  }

  snapshot(): MainLoopSnapshot {
    return {
      running: this.running,
      phase: this.phase,
      queueLength: this.queue.length,
      lastReason: this.lastReason,
      handledEvents: this.handledEvents,
    };
  }

  async runOnce(reason = "manual runOnce"): Promise<void> {
    this.lastReason = reason;
    await this.processReports(this.runtime.drainReports());
    const event = this.queue.shift() ?? { type: "heartbeat" as const, reason };
    await this.processEvent(event);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        await this.runOnce("queued event");
      }
    } finally {
      this.draining = false;
    }
  }

  private async processEvent(event: MainLoopEvent): Promise<void> {
    this.handledEvents += 1;
    this.lastReason = event.type;
    if (event.type === "shutdown") {
      this.addInnerReflection(`Main loop shutdown: ${event.reason}`);
      return;
    }

    if (event.type === "cursor_input") {
      this.phase = "acting";
      const reports = await this.runtime.sendInput(event.cursorId, event.input);
      await this.processReports(reports);
      return;
    }

    if (event.type === "cursor_report") {
      await this.processReports([event.report]);
      return;
    }

    if (event.type === "user_command") {
      this.phase = "deliberating";
      this.core.deliberate(`User command: ${event.command}`);
      this.addInnerReflection(`Deferred user command into Core Mind deliberation: ${event.command}`);
      return;
    }

    await this.innerMaintenance(event.reason);
  }

  private async processReports(reports: CursorReport[]): Promise<void> {
    for (const report of reports) {
      if (!report.needsAttention) continue;
      this.phase = "deliberating";
      const summary = `${report.cursorId}:${report.type} ${report.summary}`;
      if (report.type.includes("recall")) {
        this.core.handleRecall(summary);
      } else {
        this.core.handleEscalation(summary);
      }
      const target = this.core.cursors.get(report.cursorId);
      if (target && this.core.attachment.currentCursorId !== report.cursorId) {
        this.phase = "switching";
        await this.core.switchCursor(report.cursorId, `handle report ${report.type}`);
      }
      this.addInnerReflection(`Handled attention report from ${report.cursorId}: ${report.summary}`);
    }
  }

  private async innerMaintenance(reason: string): Promise<void> {
    this.phase = "idle_inner";
    const current = this.core.cursors.get(this.core.attachment.currentCursorId);
    if (current?.identity.kind !== "inner") {
      await this.core.returnToInnerCursor(`inner maintenance after ${reason}`);
    }
    this.addInnerReflection(`Inner maintenance heartbeat: ${reason}`);
  }

  private addInnerReflection(summary: string): void {
    this.innerCursor?.addReflection(summary);
  }
}
