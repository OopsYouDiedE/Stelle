import type { ComponentPackage } from "../protocol/component.js";
import { ComponentRegistry } from "./component_registry.js";

export class ComponentLoader {
  constructor(private readonly registry: ComponentRegistry) {}

  registerAll(packages: ComponentPackage[]): void {
    for (const pkg of packages) {
      this.registry.register(pkg);
    }
  }

  async startAll(packageIds: string[]): Promise<void> {
    for (const packageId of packageIds) {
      await this.registry.start(packageId);
    }
  }

  async stopAll(packageIds: string[]): Promise<void> {
    for (const packageId of [...packageIds].reverse()) {
      await this.registry.stop(packageId);
    }
  }
}
