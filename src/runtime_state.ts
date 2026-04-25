/**
 * 模块：运行时状态快照
 *
 * 运行逻辑：
 * - Runtime 直接持有该对象，用它记录最近事件、错误、Cursor 状态和 StelleCore 状态。
 * - Cursor 不直接访问 RuntimeState，避免被动响应层依赖调试/宿主状态。
 *
 * 主要方法：
 * - `record()`：写入滚动事件日志。
 * - `recordError()`：记录错误并保留 lastError。
 * - `snapshot()`：给 debug console 返回稳定结构。
 */
import type { CursorSnapshot } from "./cursor/types.js";

// 模块：Runtime 事件与 snapshot DTO。
export interface RuntimeEvent {
  id: string;
  type: string;
  summary: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface RuntimeStateSnapshot {
  cursors: Record<string, CursorSnapshot>;
  recentEvents: RuntimeEvent[];
  lastError?: string;
  stelleCore: {
    lastReflectionAt?: number;
    currentFocusSummary?: string;
  };
  memory: {
    channelRecentCounts: Record<string, number>;
    researchLogCount: number;
  };
  discord: { connected: boolean };
  renderer: { connected: boolean };
}

// 模块：RuntimeState 事件日志和状态聚合器。
export class RuntimeState {
  private readonly events: RuntimeEvent[] = [];
  private lastError?: string;
  private cursors: Record<string, CursorSnapshot> = {};
  private stelleCore: RuntimeStateSnapshot["stelleCore"] = {};

  record(type: string, summary: string, payload?: Record<string, unknown>): RuntimeEvent {
    const event: RuntimeEvent = {
      id: `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      summary,
      timestamp: Date.now(),
      payload,
    };
    this.events.push(event);
    while (this.events.length > 200) this.events.shift();
    return event;
  }

  recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.record("error", this.lastError);
  }

  updateCursors(snapshots: CursorSnapshot[]): void {
    this.cursors = Object.fromEntries(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  }

  updateStelleCore(snapshot: RuntimeStateSnapshot["stelleCore"]): void {
    this.stelleCore = snapshot;
  }

  snapshot(): RuntimeStateSnapshot {
    return {
      cursors: this.cursors,
      recentEvents: [...this.events].reverse().slice(0, 50),
      lastError: this.lastError,
      stelleCore: this.stelleCore,
      memory: {
        channelRecentCounts: {},
        researchLogCount: 0,
      },
      discord: { connected: false },
      renderer: { connected: false },
    };
  }
}
