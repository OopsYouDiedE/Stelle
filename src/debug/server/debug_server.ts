import type { DebugProvider, DebugCommandDefinition } from "../../core/protocol/debug.js";
import type { ComponentRegistry, ComponentPackage } from "../../core/protocol/component.js";
import type { DebugSecurityPolicy } from "./debug_auth.js";
import type { BackpressureStatus } from "../../core/protocol/backpressure.js";
import type { ResourceRef, StreamRef } from "../../core/protocol/data_ref.js";
import express from "express";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { debugHtml } from "./debug_ui.js";

export interface DebugRuntimeIntrospection {
  listResourceRefs?(): ResourceRef[];
  listStreamRefs?(): StreamRef[];
  listBackpressureStatus?(): BackpressureStatus[];
  securityMode?: "local-only" | "remote-token" | "operator";
}

export interface PluginController {
  load(id: string): Promise<void>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  unload(id: string): Promise<void>;
  listAvailable(): ComponentPackage[];
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
  private pluginController?: PluginController;
  private httpServer?: http.Server;
  private io?: SocketIOServer;

  constructor(
    private registry: ComponentRegistry,
    private policy?: DebugSecurityPolicy,
    private introspection: DebugRuntimeIntrospection = {},
  ) {}

  setPluginController(controller: PluginController) {
    this.pluginController = controller;
  }

  async startHttpServer(port: number): Promise<string> {
    if (this.httpServer) return `http://127.0.0.1:${port}`;

    const app = express();
    this.httpServer = http.createServer(app);
    this.io = new SocketIOServer(this.httpServer, { cors: { origin: "*" } });

    app.use(express.json());

    const checkAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const isLocal = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
      const token = (req.query.token as string) || req.headers.authorization?.replace("Bearer ", "");
      if (this.policy && !this.policy.canAccess(token, isLocal)) {
        res.status(403).json({ ok: false, error: "unauthorized" });
        return;
      }
      next();
    };

    app.get("/", checkAuth, (req, res) => {
      res.send(debugHtml());
    });

    app.get("/api/snapshot", checkAuth, (req, res) => {
      res.json({ ok: true, snapshot: this.getRuntimeSnapshot() });
    });

    app.get("/api/packages/available", checkAuth, (req, res) => {
      const available = this.pluginController?.listAvailable() || [];
      res.json({
        ok: true,
        available: available.map((p) => ({
          id: p.id,
          kind: p.kind,
          version: p.version,
          displayName: p.displayName,
        })),
      });
    });

    app.post("/api/packages/:id/start", checkAuth, async (req, res) => {
      if (!this.pluginController) return res.status(503).json({ ok: false, error: "plugin controller unavailable" });
      try {
        await this.pluginController.start(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post("/api/packages/:id/stop", checkAuth, async (req, res) => {
      if (!this.pluginController) return res.status(503).json({ ok: false, error: "plugin controller unavailable" });
      try {
        await this.pluginController.stop(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post("/api/packages/:id/load", checkAuth, async (req, res) => {
      if (!this.pluginController) return res.status(503).json({ ok: false, error: "plugin controller unavailable" });
      try {
        await this.pluginController.load(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post("/api/packages/:id/unload", checkAuth, async (req, res) => {
      if (!this.pluginController) return res.status(503).json({ ok: false, error: "plugin controller unavailable" });
      try {
        await this.pluginController.unload(req.params.id);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });

    this.io.on("connection", (socket) => {
      socket.emit("package:update");
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.once("error", reject);
      this.httpServer!.listen(port, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  }

  async stopHttpServer(): Promise<void> {
    if (this.io) this.io.close();
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }

  broadcastPackageEvent(type: string, packageId: string) {
    if (this.io) {
      this.io.emit("package:event", { type, packageId });
      // Tell clients to re-fetch snapshot immediately after an event finishes (stop/start etc)
      if (!type.endsWith("_start")) {
        this.io.emit("package:update");
      }
    }
  }

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
