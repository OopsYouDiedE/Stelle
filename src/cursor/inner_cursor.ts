/**
 * 模块：InnerCursor 占位人格
 *
 * 运行逻辑：
 * - 当前只作为内部状态窗口，参与 Runtime snapshot。
 * - 未来可承接主动内心独白、私有观察或 Core 与外部 Cursor 之间的缓冲层。
 *
 * 主要方法：
 * - `snapshot()`：返回当前内部 Cursor 状态。
 */
import type { CursorSnapshot, StelleCursor } from "./types.js";

export interface RuntimeDecision {
  id: string;
  type: string;
  summary: string;
  timestamp: number;
}

export class InnerCursor implements StelleCursor {
  readonly id = "inner";
  readonly kind = "inner";
  readonly displayName = "Inner Cursor";
  private readonly reflections: string[] = [];
  private readonly recentDecisions: RuntimeDecision[] = [];

  addReflection(text: string): void {
    this.reflections.push(text);
    while (this.reflections.length > 100) this.reflections.shift();
  }

  recordDecision(decision: RuntimeDecision): void {
    this.recentDecisions.push(decision);
    while (this.recentDecisions.length > 100) this.recentDecisions.shift();
  }

  buildContextBlock(): string {
    return [
      "Inner Cursor context:",
      ...this.reflections.slice(-12).map((item) => `- ${item}`),
      ...this.recentDecisions.slice(-8).map((item) => `- decision:${item.type} ${item.summary}`),
    ].join("\n");
  }

  snapshot(): CursorSnapshot {
    return {
      id: this.id,
      kind: this.kind,
      status: "idle",
      summary: this.reflections.at(-1) ?? "Inner Cursor is ready.",
      state: {
        reflectionCount: this.reflections.length,
        recentDecisionCount: this.recentDecisions.length,
        recentReflections: this.reflections.slice(-10),
      },
    };
  }
}
