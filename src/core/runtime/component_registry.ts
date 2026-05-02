import type {
  ComponentPackage,
  ComponentPackageContext,
  ComponentPackageSnapshot,
  ComponentPackageStatus,
} from "../protocol/component.js";
import type { DebugProvider } from "../../debug/contracts/debug_provider.js";

interface PackageRecord {
  pkg: ComponentPackage;
  status: ComponentPackageStatus;
  startedAt?: number;
  stoppedAt?: number;
  failureReason?: string;
  abortController: AbortController;
}

interface ProvidedValue {
  ownerPackageId: string;
  value: unknown;
}

export class ComponentRegistry {
  private readonly packages = new Map<string, PackageRecord>();
  private readonly services = new Map<string, ProvidedValue>();
  private readonly debugProviders = new Map<string, DebugProvider>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  register(pkg: ComponentPackage): void {
    if (this.packages.has(pkg.id)) throw new Error(`Component package already registered: ${pkg.id}`);
    this.assertRequirementsAvailable(pkg);
    this.packages.set(pkg.id, {
      pkg,
      status: "registered",
      abortController: new AbortController(),
    });
  }

  async unregister(packageId: string): Promise<void> {
    const record = this.getRecord(packageId);
    this.assertNoActiveDependents(packageId);
    if (record.status === "active" || record.status === "starting") {
      await this.stop(packageId);
    }
    this.removeOwnedValues(packageId);
    this.packages.delete(packageId);
  }

  async start(packageId: string): Promise<void> {
    const record = this.getRecord(packageId);
    if (record.status === "active") return;
    this.assertRequirementsActive(record.pkg);
    record.status = "starting";
    try {
      await record.pkg.register(this.createContext(record.pkg.id));
      await record.pkg.start?.(this.createContext(record.pkg.id));
      record.status = "active";
      record.startedAt = this.now();
      record.failureReason = undefined;
    } catch (error) {
      record.status = "failed";
      record.failureReason = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async stop(packageId: string): Promise<void> {
    const record = this.getRecord(packageId);
    this.assertNoActiveDependents(packageId);
    if (record.status === "stopped" || record.status === "registered") return;
    record.status = "stopping";
    record.abortController.abort();
    try {
      await record.pkg.stop?.(this.createContext(record.pkg.id));
      record.status = "stopped";
      record.stoppedAt = this.now();
    } catch (error) {
      record.status = "failed";
      record.failureReason = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.removeOwnedValues(packageId);
      record.abortController = new AbortController();
    }
  }

  provide<T>(key: string, value: T, ownerPackageId = "core.runtime"): void {
    this.services.set(key, { ownerPackageId, value });
  }

  resolve<T>(key: string): T | undefined {
    return this.services.get(key)?.value as T | undefined;
  }

  provideDebugProvider(provider: DebugProvider): void {
    const owner = this.packages.get(provider.ownerPackageId);
    if (!owner) throw new Error(`Debug provider owner is not registered: ${provider.ownerPackageId}`);
    this.debugProviders.set(provider.id, provider);
  }

  listDebugProviders(): DebugProvider[] {
    return [...this.debugProviders.values()];
  }

  listPackages(): ComponentPackageSnapshot[] {
    return [...this.packages.values()].map((record) => ({
      id: record.pkg.id,
      kind: record.pkg.kind,
      version: record.pkg.version,
      status: record.status,
      displayName: record.pkg.displayName,
      isolation: record.pkg.isolation ?? "in_process",
      requires: record.pkg.requires ?? [],
      provides: record.pkg.provides ?? [],
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      failureReason: record.failureReason,
    }));
  }

  getStatus(packageId: string): ComponentPackageStatus | undefined {
    return this.packages.get(packageId)?.status;
  }

  private createContext(packageId: string): ComponentPackageContext {
    const record = this.getRecord(packageId);
    return {
      packageId,
      registry: {
        provide: <T>(key: string, value: T) => this.provide(key, value, packageId),
        resolve: <T>(key: string) => this.resolve<T>(key),
        provideDebugProvider: (provider: unknown) => this.provideDebugProvider(provider as DebugProvider),
      },
      now: this.now,
      signal: record.abortController.signal,
    };
  }

  private assertRequirementsAvailable(pkg: ComponentPackage): void {
    for (const requirement of pkg.requires ?? []) {
      if (!requirement.optional && !this.packages.has(requirement.id)) {
        throw new Error(`Missing required component package ${requirement.id} for ${pkg.id}`);
      }
    }
  }

  private assertRequirementsActive(pkg: ComponentPackage): void {
    for (const requirement of pkg.requires ?? []) {
      if (requirement.optional) continue;
      const dependency = this.packages.get(requirement.id);
      if (!dependency || dependency.status !== "active") {
        throw new Error(`Required component package is not active: ${requirement.id}`);
      }
    }
  }

  private assertNoActiveDependents(packageId: string): void {
    const dependents = [...this.packages.values()].filter(
      (record) =>
        record.status === "active" &&
        record.pkg.requires?.some((requirement) => !requirement.optional && requirement.id === packageId),
    );
    if (dependents.length) {
      throw new Error(
        `Cannot stop or unload ${packageId}; active dependents: ${dependents.map((record) => record.pkg.id).join(", ")}`,
      );
    }
  }

  private removeOwnedValues(packageId: string): void {
    for (const [key, provided] of this.services) {
      if (provided.ownerPackageId === packageId) this.services.delete(key);
    }
    for (const [key, provider] of this.debugProviders) {
      if (provider.ownerPackageId === packageId) this.debugProviders.delete(key);
    }
  }

  private getRecord(packageId: string): PackageRecord {
    const record = this.packages.get(packageId);
    if (!record) throw new Error(`Component package is not registered: ${packageId}`);
    return record;
  }
}
