import type { RuntimeServices } from "./container.js";

/**
 * Interface for modular component registration and lifecycle management.
 * 
 * ModuleRegistrars allow decoupling the main StelleApplication from domain-specific
 * initialization, event subscriptions, and service wiring.
 */
export interface ModuleRegistrar {
  /** Unique name of the module for debugging and logging. */
  readonly name: string;

  /**
   * Wire up services, event listeners, and internal state.
   * Called during the setup phase before cursors are started.
   */
  register(services: RuntimeServices): void;

  /** Optional: Logic to run when the application starts (e.g., starting background ticks). */
  start?(): Promise<void>;

  /** Optional: Cleanup logic when the application stops. */
  stop?(): Promise<void>;
}
