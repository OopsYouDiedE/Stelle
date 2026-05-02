import type {
  ComponentPackage,
  ComponentRegisterContext,
  ComponentRuntimeContext,
  EventBus,
} from "../protocol/component.js";
import type { ComponentRegistry } from "./component_registry.js";

export interface LoaderOptions {
  registry: ComponentRegistry;
  events: EventBus;
  dataPlane?: ComponentRegisterContext["dataPlane"];
  config?: ComponentRegisterContext["config"];
  logger?: ComponentRegisterContext["logger"];
  security?: ComponentRegisterContext["security"];
  clock?: ComponentRuntimeContext["clock"];
}

export class ComponentLoader {
  constructor(private options: LoaderOptions) {}

  async load(pkg: ComponentPackage): Promise<void> {
    this.options.registry.register(pkg);

    const context: ComponentRegisterContext = {
      registry: this.options.registry,
      events: this.options.events,
      dataPlane: this.options.dataPlane || missingDataPlane(),
      config: this.options.config || {},
      logger: this.options.logger || console,
      security: this.options.security || {},
    };

    await pkg.register(context);
    const snapshot = this.options.registry.takeStateSnapshot(pkg.id);
    if (snapshot !== undefined) {
      await pkg.hydrateState?.(snapshot);
    }
  }

  async start(packageId: string): Promise<void> {
    const pkg = this.options.registry.getPackage(packageId);
    if (!pkg) {
      throw new Error(`Package "${packageId}" not found.`);
    }

    if (this.options.registry.isActive(packageId)) {
      return;
    }

    // Validate requirements
    if (pkg.requires) {
      for (const req of pkg.requires) {
        const dep = this.options.registry.getPackage(req.id);
        if (!dep && !req.optional) {
          throw new Error(`Required package "${req.id}" for "${packageId}" is not registered.`);
        }
        if (dep && !this.options.registry.isActive(req.id) && !req.optional) {
          // In a more complex loader, we might try to start dependencies recursively.
          // For now, we enforce explicit order or pre-started dependencies.
          throw new Error(`Required package "${req.id}" for "${packageId}" is not active.`);
        }
      }
    }

    const context: ComponentRuntimeContext = {
      registry: this.options.registry,
      events: this.options.events,
      dataPlane: this.options.dataPlane || missingDataPlane(),
      config: this.options.config || {},
      logger: this.options.logger || console,
      security: this.options.security || {},
      clock: this.options.clock || { now: () => Date.now() },
    };

    if (pkg.start) {
      await pkg.start(context);
    }

    this.options.registry.markActive(packageId);
  }

  async stop(packageId: string): Promise<void> {
    const pkg = this.options.registry.getPackage(packageId);
    if (!pkg || !this.options.registry.isActive(packageId)) {
      return;
    }

    // Check if other active packages depend on this one
    for (const other of this.options.registry.listPackages()) {
      if (this.options.registry.isActive(other.id) && other.requires) {
        const dependsOnThis = other.requires.some((r) => r.id === packageId && !r.optional);
        if (dependsOnThis) {
          throw new Error(`Cannot stop "${packageId}" because "${other.id}" depends on it.`);
        }
      }
    }

    const context: ComponentRuntimeContext = {
      registry: this.options.registry,
      events: this.options.events,
      dataPlane: this.options.dataPlane || missingDataPlane(),
      config: this.options.config || {},
      logger: this.options.logger || console,
      security: this.options.security || {},
      clock: this.options.clock || { now: () => Date.now() },
    };

    const unloadPlan = await pkg.prepareUnload?.();
    if (unloadPlan && unloadPlan.acceptNewWork !== false) {
      throw new Error(`Package "${packageId}" returned an invalid unload plan.`);
    }

    if (pkg.stop) {
      await pkg.stop(context);
    }

    this.options.registry.markInactive(packageId);
  }

  async unload(packageId: string): Promise<void> {
    const pkg = this.options.registry.getPackage(packageId);
    await this.stop(packageId);
    const snapshot = await pkg?.snapshotState?.();
    this.options.registry.unregister(packageId);
    if (snapshot !== undefined) {
      this.options.registry.rememberStateSnapshot(packageId, snapshot);
    }
  }
}

function missingDataPlane(): ComponentRegisterContext["dataPlane"] {
  const fail = () => {
    throw new Error("DataPlane is not configured for this ComponentLoader.");
  };
  return {
    putBlob: fail,
    readBlob: fail,
    release: fail,
    createStream: fail,
    subscribe: fail,
  };
}
