import type { CursorActivation, CursorHost, CursorReport } from "../cursors/base.js";

export interface CursorSnapshotProvider {
  snapshot(): Promise<unknown>;
}

export interface AttentionActivation {
  cursorId: string;
  activation: CursorActivation;
}

export interface AttentionCycleResult {
  reports: CursorReport[];
  idleActivations: AttentionActivation[];
  ranIdleStrategy: boolean;
  timestamp: number;
}

export interface IdleContext {
  mainLoop: MainLoop;
  reports: CursorReport[];
  snapshot: MainLoopSnapshot;
}

export type IdleStrategy =
  | ((context: IdleContext) => Promise<AttentionActivation[]>)
  | ((context: IdleContext) => AttentionActivation[]);

export interface MainLoopSnapshot {
  registeredCursorIds: string[];
  lastTickAt: number | null;
  lastAttentionAt: number | null;
  bufferedReportCount: number;
  cycleCount: number;
}

function now(): number {
  return Date.now();
}

export class MainLoop {
  private readonly cursors = new Map<string, CursorHost>();
  private readonly reportBuffer: CursorReport[] = [];
  private lastTickAt: number | null = null;
  private lastAttentionAt: number | null = null;
  private cycleCount = 0;
  private idleStrategy: IdleStrategy | null = null;
  private attentionRunning = false;

  registerCursor(cursor: CursorHost): void {
    this.cursors.set(cursor.id, cursor);
  }

  hasCursor(cursorId: string): boolean {
    return this.cursors.has(cursorId);
  }

  getCursor(cursorId: string): CursorHost | null {
    return this.cursors.get(cursorId) ?? null;
  }

  async activateCursor(
    cursorId: string,
    activation: CursorActivation
  ): Promise<void> {
    const cursor = this.cursors.get(cursorId);
    if (!cursor) {
      throw new Error(`Cursor "${cursorId}" is not registered.`);
    }
    await cursor.activate(activation);
  }

  async tickCursor(cursorId: string): Promise<CursorReport[]> {
    const cursor = this.cursors.get(cursorId);
    if (!cursor) {
      throw new Error(`Cursor "${cursorId}" is not registered.`);
    }
    const reports = await cursor.tick();
    this.pushReports(reports);
    this.lastTickAt = now();
    return reports;
  }

  async tickAll(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];
    for (const cursor of this.cursors.values()) {
      const cursorReports = await cursor.tick();
      reports.push(...cursorReports);
    }
    this.pushReports(reports);
    this.lastTickAt = now();
    return reports;
  }

  setIdleStrategy(strategy: IdleStrategy | null): void {
    this.idleStrategy = strategy;
  }

  async runAttentionCycle(): Promise<AttentionCycleResult> {
    if (this.attentionRunning) {
      return {
        reports: [],
        idleActivations: [],
        ranIdleStrategy: false,
        timestamp: now(),
      };
    }

    this.attentionRunning = true;
    try {
      const reports = await this.tickAll();
      let idleActivations: AttentionActivation[] = [];
      let ranIdleStrategy = false;

      if (!reports.length && this.idleStrategy) {
        ranIdleStrategy = true;
        const snapshot = await this.snapshot();
        idleActivations = await this.idleStrategy({
          mainLoop: this,
          reports,
          snapshot,
        });
        for (const item of idleActivations) {
          if (!this.hasCursor(item.cursorId)) continue;
          await this.activateCursor(item.cursorId, item.activation);
          const followupReports = await this.tickCursor(item.cursorId);
          reports.push(...followupReports);
        }
      }

      this.lastAttentionAt = now();
      this.cycleCount += 1;
      return {
        reports,
        idleActivations,
        ranIdleStrategy,
        timestamp: this.lastAttentionAt,
      };
    } finally {
      this.attentionRunning = false;
    }
  }

  drainReports(): CursorReport[] {
    const drained = [...this.reportBuffer];
    this.reportBuffer.length = 0;
    return drained;
  }

  async snapshot(): Promise<MainLoopSnapshot> {
    return {
      registeredCursorIds: [...this.cursors.keys()],
      lastTickAt: this.lastTickAt,
      lastAttentionAt: this.lastAttentionAt,
      bufferedReportCount: this.reportBuffer.length,
      cycleCount: this.cycleCount,
    };
  }

  async snapshotCursor(cursorId: string): Promise<unknown | null> {
    const cursor = this.cursors.get(cursorId);
    if (!cursor) return null;
    const provider = cursor as CursorHost & Partial<CursorSnapshotProvider>;
    if (typeof provider.snapshot !== "function") return null;
    return provider.snapshot();
  }

  private pushReports(reports: CursorReport[]): void {
    this.reportBuffer.push(...reports);
    if (this.reportBuffer.length > 200) {
      this.reportBuffer.splice(0, this.reportBuffer.length - 200);
    }
  }
}
