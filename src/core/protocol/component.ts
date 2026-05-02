import type { PackageBackpressurePolicy } from "./data_ref.js";

export type ComponentPackageKind = "core" | "capability" | "window" | "debug";
export type ComponentPackageStatus = "registered" | "starting" | "active" | "stopping" | "stopped" | "failed";
export type ComponentPackageIsolation = "in_process" | "worker_thread" | "external_process";

export interface ComponentRequirement {
  id: string;
  optional?: boolean;
  versionRange?: string;
}

export interface ComponentProvision {
  id: string;
  kind: "service" | "read_model" | "debug_provider" | "event_handler" | "intent_handler" | "window";
  version?: string;
}

export interface ComponentPackageContext {
  packageId: string;
  registry: {
    provide<T>(key: string, value: T): void;
    resolve<T>(key: string): T | undefined;
    provideDebugProvider(provider: unknown): void;
  };
  now(): number;
  signal?: AbortSignal;
}

export interface ComponentPackage {
  id: string;
  kind: ComponentPackageKind;
  version: string;
  displayName?: string;
  requires?: ComponentRequirement[];
  provides?: ComponentProvision[];
  isolation?: ComponentPackageIsolation;
  backpressure?: PackageBackpressurePolicy;
  register(ctx: ComponentPackageContext): void | Promise<void>;
  start?(ctx: ComponentPackageContext): void | Promise<void>;
  stop?(ctx: ComponentPackageContext): void | Promise<void>;
}

export interface StatefulComponentPackage extends ComponentPackage {
  snapshotState?(): Promise<unknown> | unknown;
  hydrateState?(state: unknown): Promise<void> | void;
  prepareUnload?(): Promise<UnloadPlan> | UnloadPlan;
}

export interface UnloadPlan {
  acceptNewWork: false;
  pendingWork: "drain" | "cancel" | "handoff" | "drop_expired";
  estimatedMs?: number;
  reason: string;
}

export interface ComponentPackageSnapshot {
  id: string;
  kind: ComponentPackageKind;
  version: string;
  status: ComponentPackageStatus;
  displayName?: string;
  isolation: ComponentPackageIsolation;
  requires: ComponentRequirement[];
  provides: ComponentProvision[];
  startedAt?: number;
  stoppedAt?: number;
  failureReason?: string;
}
