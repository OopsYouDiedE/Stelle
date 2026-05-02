import type { DebugProvider } from "../../debug/contracts/debug_provider.js";
import type { DataRefKind, ResourceRef, StreamRef } from "./data_ref.js";
import type { PackageBackpressurePolicy } from "./backpressure.js";

export interface ComponentRegistry {
  provide<T>(key: string, value: T): void;
  provideForPackage?<T>(packageId: string, key: string, value: T): void;
  resolve<T>(key: string): T | undefined;
  provideDebugProvider(provider: DebugProvider): void;
  listDebugProviders(): DebugProvider[];
  listPackages?(): ComponentPackage[];
  listActivePackageIds?(): string[];
}

export interface EventBus {
  publish(input: { type: string; source: string } & Record<string, unknown>): void;
  subscribe(type: string, listener: (event: unknown) => void): () => void;
}

export interface DataPlane {
  putBlob(input: {
    ownerPackageId: string;
    kind: DataRefKind;
    mediaType?: string;
    data: Uint8Array | string | object;
    ttlMs: number;
    accessScope?: ResourceRef["accessScope"];
    metadata?: Record<string, unknown>;
  }): Promise<ResourceRef>;
  readBlob(ref: ResourceRef, requesterPackageId: string): Promise<Uint8Array | string | object>;
  release(refId: string, requesterPackageId: string): Promise<void>;
  createStream(input: {
    ownerPackageId: string;
    kind: StreamRef["kind"];
    transport?: StreamRef["transport"];
    latestOnly?: boolean;
    ttlMs?: number;
    maxQueueSize?: number;
    overflow?: PackageBackpressurePolicy["overflow"];
    metadata?: Record<string, unknown>;
  }): Promise<StreamRef>;
  subscribe(streamRef: StreamRef, requesterPackageId: string): AsyncIterable<unknown>;
}

export interface ConfigReader {
  get?<T = unknown>(key: string): T | undefined;
}
export interface Logger {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}

export interface SecurityService {
  canAccessResource?(input: {
    resource: ResourceRef;
    requesterPackageId: string;
    operation: "read" | "release";
  }): boolean;
}
export interface Clock {
  now(): number;
}

export type ComponentKind = "capability" | "window" | "debug";

export interface UnloadPlan {
  acceptNewWork: false;
  pendingWork: "drain" | "cancel" | "handoff" | "drop_expired";
  estimatedMs?: number;
  reason: string;
}

export interface ComponentPackage {
  id: string;
  kind: ComponentKind;
  version: string;
  displayName: string;

  isolation?: "in_process" | "worker_thread" | "external_process";

  requires?: ComponentRequirement[];
  provides?: ComponentProvision[];
  backpressure?: PackageBackpressurePolicy;

  register(context: ComponentRegisterContext): Promise<void> | void;
  start?(context: ComponentRuntimeContext): Promise<void> | void;
  stop?(context: ComponentRuntimeContext): Promise<void> | void;

  snapshotState?(): Promise<unknown>;
  hydrateState?(state: unknown): Promise<void>;
  prepareUnload?(): Promise<UnloadPlan>;

  getDebugProvider?(): DebugProvider | undefined;
}

export interface ComponentRequirement {
  id: string;
  kind?: ComponentKind;
  optional?: boolean;
}

export interface ComponentProvision {
  id: string;
  kind: "service" | "read_model" | "event_handler" | "intent_handler" | "debug_provider";
}

export interface ComponentRegisterContext {
  registry: ComponentRegistry;
  events: EventBus;
  dataPlane: DataPlane;
  config: ConfigReader;
  logger: Logger;
  security: SecurityService;
}

export interface ComponentRuntimeContext extends ComponentRegisterContext {
  clock: Clock;
}
