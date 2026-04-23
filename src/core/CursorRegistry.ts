import type { CoreMindCursorView, CursorHost } from "../types.js";

export class CursorRegistry {
  private readonly cursors = new Map<string, CursorHost>();

  register(cursor: CursorHost): void {
    if (this.cursors.has(cursor.identity.id)) {
      throw new Error(`Cursor already registered: ${cursor.identity.id}`);
    }
    this.cursors.set(cursor.identity.id, cursor);
  }

  get(cursorId: string): CursorHost | undefined {
    return this.cursors.get(cursorId);
  }

  has(cursorId: string): boolean {
    return this.cursors.has(cursorId);
  }

  list(): CursorHost[] {
    return [...this.cursors.values()];
  }

  view(): CoreMindCursorView[] {
    return this.list().map((cursor) => {
      const state = cursor.getState();
      return {
        cursorId: cursor.identity.id,
        kind: cursor.identity.kind,
        status: state.status,
        summary: state.summary,
        canAttach: state.status !== "offline" && state.status !== "error",
        needsAttention: state.status === "degraded" || state.status === "error",
      };
    });
  }
}
