import { type StelleEventType } from "../utils/event_schema.js";

export interface SchedulerOptions {
  liveEnabled?: boolean;
  innerEnabled?: boolean;
  liveTickMs?: number;
  innerTickMs?: number;
}

interface ScheduledTask {
  id: string;
  type: StelleEventType;
  intervalMs: number;
  lastRunAt: number;
  timer: NodeJS.Timeout | null;
}

/**
 * 模块：Stelle 任务调度器
 * 
 * 核心改进：
 * 1. 防重复启动：维护状态锁，避免多次 setInterval 堆积。
 * 2. 任务注册制：为后续扩展更多的周期性任务 (e.g., presence, memory_cleanup) 预留接口。
 * 3. 结构化事件：回调返回类型安全的事件参数。
 */
export class StelleScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private running = false;
  private tickListener?: (type: StelleEventType, reason: string) => void;

  constructor(private readonly options: SchedulerOptions = {}) {}

  public onTick(listener: (type: StelleEventType, reason: string) => void): void {
    this.tickListener = listener;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;

    const liveMs = this.options.liveTickMs ?? 1800;
    const innerMs = this.options.innerTickMs ?? 45_000;

    if (this.options.liveEnabled) {
      this.register("live_tick", "live.tick", liveMs);
    }

    if (this.options.innerEnabled !== false) {
      this.register("inner_tick", "inner.tick", innerMs);
    }
    
    // 预留 Core Tick 路径
    this.register("core_tick", "core.tick", 300_000); // 默认 5 分钟
  }

  private register(id: string, type: StelleEventType, intervalMs: number) {
    if (this.tasks.has(id)) return;

    const timer = setInterval(() => {
      const task = this.tasks.get(id);
      if (task) {
        task.lastRunAt = Date.now();
        this.tickListener?.(task.type, `scheduler_interval_${id}`);
      }
    }, intervalMs);

    this.tasks.set(id, { id, type, intervalMs, lastRunAt: 0, timer });
  }

  public stop(): void {
    this.running = false;
    for (const task of this.tasks.values()) {
      if (task.timer) clearInterval(task.timer);
    }
    this.tasks.clear();
  }
}
