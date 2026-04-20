import type { CursorActivation, CursorHost, CursorReport } from "../cursors/base.js";

export interface WindowRegistrySnapshot {
  registeredCursorIds: string[];
  lastTickAt: number | null;
  lastAttentionAt: number | null;
  cycleCount: number;
}

function now(): number {
  return Date.now();
}

export class WindowRegistry {
  private readonly cursors = new Map<string, CursorHost>();
  private lastTickAt: number | null = null;
  private lastAttentionAt: number | null = null;
  private cycleCount = 0;

  register(cursor: CursorHost): void {
    this.cursors.set(cursor.id, cursor);
  }

  has(cursorId: string): boolean {
    return this.cursors.has(cursorId);
  }

  get(cursorId: string): CursorHost | null {
    return this.cursors.get(cursorId) ?? null;
  }

  async activate(
    cursorId: string,
    activation: CursorActivation
  ): Promise<void> {
    const cursor = this.require(cursorId);
    await cursor.activate(activation);
  }

  async tick(cursorId: string): Promise<CursorReport[]> {
    const cursor = this.require(cursorId);
    const reports = await cursor.tick();
    this.lastTickAt = now();
    return reports;
  }

  async tickAll(): Promise<CursorReport[]> {
    const reports: CursorReport[] = [];
    for (const cursor of this.cursors.values()) {
      reports.push(...await cursor.tick());
    }
    this.lastTickAt = now();
    return reports;
  }

  noteAttentionCycle(timestamp: number = now()): void {
    this.lastAttentionAt = timestamp;
    this.cycleCount += 1;
  }

  async snapshot(): Promise<WindowRegistrySnapshot> {
    return {
      registeredCursorIds: [...this.cursors.keys()],
      lastTickAt: this.lastTickAt,
      lastAttentionAt: this.lastAttentionAt,
      cycleCount: this.cycleCount,
    };
  }

  private require(cursorId: string): CursorHost {
    const cursor = this.cursors.get(cursorId);
    if (!cursor) {
      throw new Error(`Cursor "${cursorId}" is not registered.`);
    }
    return cursor;
  }
}
