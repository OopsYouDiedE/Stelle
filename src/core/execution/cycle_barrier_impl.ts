import type { StelleEventBus } from "../event/event_bus.js";
import type { CycleBarrier, BarrierRequirement, BarrierResult, BarrierStatus } from "./cycle_barrier.js";

/**
 * 循环屏障的事件总线实现
 */
export class EventBusCycleBarrier implements CycleBarrier {
  constructor(
    public readonly cycleId: string,
    private readonly eventBus: StelleEventBus
  ) {}

  public async waitFor(requirements: BarrierRequirement[], timeoutMs: number): Promise<BarrierResult> {
    const receivedEvents: string[] = [];
    const pendingRequirements = new Set(requirements);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ status: "timeout", receivedEvents });
      }, timeoutMs);

      const cleanup = this.eventBus.subscribe("*", (event) => {
        for (const req of pendingRequirements) {
          if (this.matches(event, req)) {
            receivedEvents.push(event.id);
            pendingRequirements.delete(req);
            break;
          }
        }

        if (pendingRequirements.size === 0) {
          clearTimeout(timeout);
          cleanup();
          resolve({ status: "met", metAt: new Date().toISOString(), receivedEvents });
        }
      });
    });
  }

  private matches(event: any, req: BarrierRequirement): boolean {
    if (event.type !== req.eventName) return false;
    if (req.cycleId && event.cycleId !== req.cycleId) return false;
    if (req.correlationId && event.correlationId !== req.correlationId) return false;
    if (req.source && event.source !== req.source) return false;
    return true;
  }
}
