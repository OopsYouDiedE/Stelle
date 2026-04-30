import type { ModuleRegistrar } from "../registrar.js";
import type { RuntimeServices } from "../container.js";
import { LiveRuntimeServices } from "../live_services.js";
import type { LiveRendererServer } from "../../live/infra/renderer_server.js";

export class LiveModule implements ModuleRegistrar {
  readonly name = "live";
  private liveRuntimeServices?: LiveRuntimeServices;

  constructor(
    private readonly mode: string,
    private readonly renderer?: LiveRendererServer
  ) {}

  register(services: RuntimeServices): void {
    if (this.mode !== "runtime" && this.mode !== "live") return;
    this.liveRuntimeServices = new LiveRuntimeServices(services, this.renderer);
  }

  async start(): Promise<void> {
    await this.liveRuntimeServices?.start();
  }

  async stop(): Promise<void> {
    await this.liveRuntimeServices?.stop();
  }

  get health() { return this.liveRuntimeServices?.health; }
  get journal() { return this.liveRuntimeServices?.journal; }
  get topicScripts() { return this.liveRuntimeServices?.topicScripts; }
  
  runTopicScriptCommand(input: Record<string, unknown>) {
    return this.liveRuntimeServices?.runTopicScriptCommand(input);
  }
}
