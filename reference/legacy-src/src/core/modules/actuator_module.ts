import type { ModuleRegistrar } from "../registrar.js";
import type { RuntimeServices } from "../container.js";

export class ActuatorModule implements ModuleRegistrar {
  readonly name = "actuator";

  register(services: RuntimeServices): void {
    // Currently, arbiters are created in StelleContainer.
    // This module can handle specific actuator event wiring if needed.
  }
}
