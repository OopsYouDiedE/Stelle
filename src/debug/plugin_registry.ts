import type { ComponentPackage } from "../core/protocol/component.js";

export class PluginRegistry {
  private catalog = new Map<string, ComponentPackage>();

  register(pkg: ComponentPackage): void {
    this.catalog.set(pkg.id, pkg);
  }

  get(id: string): ComponentPackage | undefined {
    return this.catalog.get(id);
  }

  list(): ComponentPackage[] {
    return Array.from(this.catalog.values());
  }
}
