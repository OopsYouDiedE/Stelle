import type { ModuleRegistrar } from "../registrar.js";
import type { RuntimeServices } from "../container.js";
import type { StelleScheduler } from "../scheduler.js";

/**
 * CoreModule
 * 
 * Manages foundational runtime wiring, including scheduler-to-bus bridging
 * and global cursor reflection logging.
 */
export class CoreModule implements ModuleRegistrar {
  readonly name = "core";

  constructor(private readonly scheduler: StelleScheduler) {}

  register(services: RuntimeServices): void {
    this.scheduler.onTick((type, reason) => {
      services.eventBus.publish({ type: type as any, source: "scheduler", reason });
    });

    services.eventBus.subscribe("cursor.reflection", (event) => {
      services.state.record("cursor_reflection", event.payload.summary, event.payload);
    });
  }
}
