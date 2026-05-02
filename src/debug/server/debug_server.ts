import type { DebugProvider, DebugCommandDefinition } from "../contracts/debug_provider.js";
import type { ComponentRegistry } from "../../core/protocol/component.js";
import type { DebugSecurityPolicy } from "./debug_auth.js";
import type { BackpressureStatus } from "../../core/protocol/backpressure.js";
import type { ResourceRef, StreamRef } from "../../core/protocol/data_ref.js";

export interface DebugRuntimeIntrospection {
  listResourceRefs?(): ResourceRef[];
  listStreamRefs?(): StreamRef[];
  listBackpressureStatus?(): BackpressureStatus[];
  securityMode?: "local-only" | "remote-token" | "operator";
}

export interface DebugRuntimeSnapshot {
  packages: Array<{ id: string; kind: string; version: string; displayName: string; active: boolean }>;
  capabilities: string[];
  windows: string[];
  providers: Array<{ id: string; title: string; ownerPackageId: string; panelCount: number; commandCount: number }>;
  resources: ResourceRef[];
  streams: StreamRef[];
  backpressure: BackpressureStatus[];
  securityMode: string;
  auditLog: ReturnType<DebugSecurityPolicy["getAuditLog"]>;
}

export class DebugServer {
  constructor(
    private registry: ComponentRegistry,
    private policy?: DebugSecurityPolicy,
    private introspection: DebugRuntimeIntrospection = {},
  ) {}

  async listProviders(): Promise<DebugProvider[]> {
    return this.registry.listDebugProviders();
  }

  async getSnapshot(providerId: string): Promise<unknown> {
    const provider = this.registry.listDebugProviders().find((p) => p.id === providerId);
    if (!provider || !provider.getSnapshot) return null;
    return provider.getSnapshot();
  }

  async runCommand(
    providerId: string,
    commandId: string,
    input: unknown,
    context: { isLocal?: boolean; token?: string } = { isLocal: true },
  ): Promise<unknown> {
    const requester = context.isLocal ? "local" : "remote";
    if (this.policy && !this.policy.canAccess(context.token, context.isLocal)) {
      this.policy.recordCommand({
        providerId,
        commandId,
        risk: "read",
        requester,
        allowed: false,
        reason: "unauthorized",
      });
      throw new Error("Unauthorized access to debug commands");
    }

    const provider = this.registry.listDebugProviders().find((p) => p.id === providerId);
    const command = provider?.commands?.find((c) => c.id === commandId);

    if (!command) throw new Error(`Command ${commandId} not found in provider ${providerId}`);

    if (this.policy && !this.policy.canRunCommand(command.risk, context.isLocal, command.id)) {
      this.policy.recordCommand({
        providerId,
        commandId,
        risk: command.risk,
        requester,
        allowed: false,
        reason: "risk_rejected",
      });
      throw new Error(`Command ${commandId} rejected due to risk level ${command.risk} in current context`);
    }

    this.policy?.recordCommand({
      providerId,
      commandId,
      risk: command.risk,
      requester,
      allowed: true,
      reason: "allowed",
    });
    return command.run(input);
  }
  // Unified global snapshot for the old shell compatibility
  async getGlobalSnapshot(): Promise<Record<string, unknown>> {
    const providers = this.registry.listDebugProviders();
    const result: Record<string, unknown> = {};

    for (const p of providers) {
      if (p.getSnapshot) {
        result[p.ownerPackageId] = await p.getSnapshot();
      }
    }

    return result;
  }

  getRuntimeSnapshot(): DebugRuntimeSnapshot {
    const packages = this.registry.listPackages?.() ?? [];
    const active = new Set(this.registry.listActivePackageIds?.() ?? []);
    return {
      packages: packages.map((pkg) => ({
        id: pkg.id,
        kind: pkg.kind,
        version: pkg.version,
        displayName: pkg.displayName,
        active: active.has(pkg.id),
      })),
      capabilities: packages.filter((pkg) => pkg.kind === "capability").map((pkg) => pkg.id),
      windows: packages.filter((pkg) => pkg.kind === "window").map((pkg) => pkg.id),
      providers: this.registry.listDebugProviders().map((provider) => ({
        id: provider.id,
        title: provider.title,
        ownerPackageId: provider.ownerPackageId,
        panelCount: provider.panels?.length ?? 0,
        commandCount: provider.commands?.length ?? 0,
      })),
      resources: this.introspection.listResourceRefs?.() ?? [],
      streams: this.introspection.listStreamRefs?.() ?? [],
      backpressure: this.introspection.listBackpressureStatus?.() ?? [],
      securityMode: this.introspection.securityMode ?? "local-only",
      auditLog: this.getAuditLog(),
    };
  }

  getAuditLog() {
    return this.policy?.getAuditLog() ?? [];
  }
}
