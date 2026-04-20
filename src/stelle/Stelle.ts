import { WindowRegistry } from "../core/windowRegistry.js";
import type { CursorActivation, CursorHost, CursorReport } from "../cursors/base.js";
import { ConsciousnessCursor } from "./consciousness/ConsciousnessCursor.js";
import { ExperienceStore, type ExperienceSource } from "./ExperienceStore.js";
import { MemoryStore } from "./memory/MemoryStore.js";
import type {
  AttentionActivation,
  AttentionCycleResult,
  MemoryReflection,
  StelleSnapshot,
} from "./types.js";

function now(): number {
  return Date.now();
}

export class Stelle {
  readonly windows: WindowRegistry;
  readonly consciousness: ConsciousnessCursor;
  readonly experience: ExperienceStore;
  readonly memory: MemoryStore;

  private attentionRunning = false;

  constructor(options?: {
    windows?: WindowRegistry;
    consciousness?: ConsciousnessCursor;
    experience?: ExperienceStore;
    memory?: MemoryStore;
  }) {
    this.windows = options?.windows ?? new WindowRegistry();
    this.consciousness = options?.consciousness ?? new ConsciousnessCursor();
    this.experience = options?.experience ?? new ExperienceStore();
    this.memory = options?.memory ?? new MemoryStore();
  }

  registerWindow(cursor: CursorHost): void {
    this.windows.register(cursor);
  }

  hasCursor(cursorId: string): boolean {
    return this.windows.has(cursorId);
  }

  getCursor(cursorId: string): CursorHost | null {
    return this.windows.get(cursorId);
  }

  async activateCursor(
    cursorId: string,
    activation: CursorActivation
  ): Promise<void> {
    await this.windows.activate(cursorId, activation);
  }

  async tickCursor(cursorId: string): Promise<CursorReport[]> {
    return this.collectReports(() => this.windows.tick(cursorId));
  }

  async runAttentionCycle(): Promise<AttentionCycleResult> {
    if (this.attentionRunning) {
      return {
        reports: [],
        idleActivations: [],
        memoryReflections: [],
        decisions: [],
        ranConsciousness: false,
        timestamp: now(),
      };
    }

    this.attentionRunning = true;
    try {
      const reports = await this.collectReports(() => this.windows.tickAll());

      let idleActivations: AttentionActivation[] = [];
      let memoryReflections: MemoryReflection[] = [];
      let decisions: AttentionCycleResult["decisions"] = [];
      let ranConsciousness = false;

      if (!reports.length) {
        ranConsciousness = true;
        const timestamp = now();
        const idleResult = await this.consciousness.runIdleCycle({
          windows: await this.windows.snapshot(),
          recentExperiences: this.experience.recent(24),
          timestamp,
        });
        idleActivations = idleResult.idleActivations;
        memoryReflections = idleResult.memoryReflections;
        decisions = idleResult.decisions;
        await this.memory.remember(memoryReflections);
        this.ingestReports(idleResult.reports);
        reports.push(...idleResult.reports);

        for (const item of idleActivations) {
          if (!this.windows.has(item.cursorId)) continue;
          await this.windows.activate(item.cursorId, item.activation);
          const followupReports = await this.collectReports(() =>
            this.windows.tick(item.cursorId)
          );
          reports.push(...followupReports);
        }
      }

      const timestamp = now();
      this.windows.noteAttentionCycle(timestamp);
      return {
        reports,
        idleActivations,
        memoryReflections,
        decisions,
        ranConsciousness,
        timestamp,
      };
    } finally {
      this.attentionRunning = false;
    }
  }

  async snapshot(): Promise<StelleSnapshot> {
    return {
      identity: "Stelle",
      windows: await this.windows.snapshot(),
      experience: this.experience.snapshot(),
      memory: this.memory.snapshot(),
      consciousness: this.consciousness.snapshot(),
    };
  }

  private async collectReports(
    read: () => Promise<CursorReport[]>
  ): Promise<CursorReport[]> {
    const reports = await read();
    this.ingestReports(reports);
    return reports;
  }

  private ingestReports(reports: CursorReport[]): void {
    if (!reports.length) return;
    this.experience.appendReports(reports, (report) => this.sourceForReport(report));
  }

  private sourceForReport(report: CursorReport): ExperienceSource {
    if (report.cursorId === this.consciousness.id) {
      return { cursorId: this.consciousness.id, kind: this.consciousness.kind };
    }
    const cursor = this.windows.get(report.cursorId);
    return {
      cursorId: report.cursorId,
      kind: cursor?.kind ?? "unknown",
    };
  }
}
