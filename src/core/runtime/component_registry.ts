import type { ComponentPackage, ComponentRegistry as IComponentRegistry } from "../protocol/component.js";
import type { DebugProvider } from "../../debug/contracts/debug_provider.js";

export class ComponentRegistry implements IComponentRegistry {
  private packages = new Map<string, ComponentPackage>();
  private services = new Map<string, unknown>();
  private serviceOwners = new Map<string, string>();
  private debugProviders = new Map<string, DebugProvider>();
  private activePackageIds = new Set<string>();
  private stateSnapshots = new Map<string, unknown>();

  register(pkg: ComponentPackage): void {
    if (this.packages.has(pkg.id)) {
      throw new Error(`Package with id "${pkg.id}" is already registered.`);
    }
    this.packages.set(pkg.id, pkg);
  }

  unregister(packageId: string): void {
    if (this.activePackageIds.has(packageId)) {
      throw new Error(`Cannot unregister active package "${packageId}". Stop it first.`);
    }
    this.packages.delete(packageId);
    for (const [key, owner] of this.serviceOwners) {
      if (owner === packageId) {
        this.services.delete(key);
        this.serviceOwners.delete(key);
      }
    }
    for (const [id, provider] of this.debugProviders) {
      if (provider.ownerPackageId === packageId) {
        this.debugProviders.delete(id);
      }
    }
  }

  provide<T>(key: string, value: T): void {
    this.services.set(key, value);
  }

  provideForPackage<T>(packageId: string, key: string, value: T): void {
    this.services.set(key, value);
    this.serviceOwners.set(key, packageId);
  }

  resolve<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }

  provideDebugProvider(provider: DebugProvider): void {
    this.debugProviders.set(provider.id, provider);
  }

  listDebugProviders(): DebugProvider[] {
    return Array.from(this.debugProviders.values());
  }

  getPackage(packageId: string): ComponentPackage | undefined {
    return this.packages.get(packageId);
  }

  listPackages(): ComponentPackage[] {
    return Array.from(this.packages.values());
  }

  listActivePackageIds(): string[] {
    return Array.from(this.activePackageIds.values());
  }

  getDependents(packageId: string): ComponentPackage[] {
    return this.listPackages().filter((pkg) =>
      pkg.requires?.some((requirement) => requirement.id === packageId && !requirement.optional),
    );
  }

  markActive(packageId: string): void {
    this.activePackageIds.add(packageId);
  }

  markInactive(packageId: string): void {
    this.activePackageIds.delete(packageId);
  }

  isActive(packageId: string): boolean {
    return this.activePackageIds.has(packageId);
  }

  rememberStateSnapshot(packageId: string, snapshot: unknown): void {
    this.stateSnapshots.set(packageId, snapshot);
  }

  takeStateSnapshot(packageId: string): unknown | undefined {
    const snapshot = this.stateSnapshots.get(packageId);
    this.stateSnapshots.delete(packageId);
    return snapshot;
  }
}
