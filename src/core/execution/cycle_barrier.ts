export interface BarrierRequirement {
  eventName: string;
  source?: string;
  correlationId?: string;
  cycleId?: string;
}

export type BarrierStatus = "met" | "timeout" | "cancelled";

export interface BarrierResult {
  status: BarrierStatus;
  metAt?: string;
  receivedEvents: string[]; // IDs of events that met the requirement
}

/**
 * 循环屏障 (Cycle Barrier)
 * 用于在异步决策循环中进行必要的同步等待。
 */
export interface CycleBarrier {
  cycleId: string;
  /**
   * 等待指定的事件集完成或超时。
   */
  waitFor(requirements: BarrierRequirement[], timeoutMs: number): Promise<BarrierResult>;
}
