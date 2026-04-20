import type { CursorReport } from "../cursors/base.js";
import type { Experience, ExperienceStoreSnapshot } from "./types.js";

export interface ExperienceSource {
  cursorId: string;
  kind: string;
}

export class ExperienceStore {
  private readonly items: Experience[] = [];
  private nextId = 1;

  constructor(private readonly maxItems = 500) {}

  appendReport(report: CursorReport, source: ExperienceSource): Experience {
    const experience: Experience = {
      id: `exp-${this.nextId++}`,
      sourceCursorId: source.cursorId,
      sourceKind: source.kind,
      type: report.type,
      summary: report.summary,
      payload: report.payload,
      salience: inferSalience(report),
      occurredAt: report.timestamp,
      receivedAt: Date.now(),
    };
    this.items.push(experience);
    this.trim();
    return experience;
  }

  appendReports(
    reports: readonly CursorReport[],
    resolveSource: (report: CursorReport) => ExperienceSource
  ): void {
    for (const report of reports) {
      this.appendReport(report, resolveSource(report));
    }
  }

  recent(limit = 24): Experience[] {
    return this.items.slice(Math.max(0, this.items.length - limit));
  }

  snapshot(limit = 12): ExperienceStoreSnapshot {
    return {
      totalCount: this.items.length,
      recent: this.recent(limit),
    };
  }

  private trim(): void {
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
  }
}

function inferSalience(report: CursorReport): number {
  const type = report.type.toLowerCase();
  if (type.includes("error") || type.includes("failed")) return 0.9;
  if (type.includes("message") || type.includes("interaction")) return 0.75;
  if (type.includes("complete") || type.includes("done")) return 0.7;
  if (type.includes("typing") || type.includes("snapshot")) return 0.35;
  return 0.5;
}
