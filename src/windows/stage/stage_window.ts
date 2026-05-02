import { loadDebugConfig } from "../../debug/config.js";
import { loadControlConfig } from "../../debug/config.js";
import { loadLiveConfig } from "../live/config.js";
import { LiveRendererServer } from "./renderer/renderer_server.js";


export interface StageWindowOptions {
  config: any;
  logger: Pick<Console, "info" | "warn" | "error">;
  getDebugSnapshot?: () => Record<string, unknown>;
}

export class StageWindow {
  private renderer?: LiveRendererServer;
  private url?: string;

  constructor(private readonly options: StageWindowOptions) {}

  async start(): Promise<void> {
    this.renderer = new LiveRendererServer({
      host: loadLiveConfig(this.options.config.rawYaml).rendererHost,
      port: loadLiveConfig(this.options.config.rawYaml).rendererPort,
      debug: {
        enabled: loadDebugConfig(this.options.config.rawYaml).enabled,
        requireToken: loadDebugConfig(this.options.config.rawYaml).requireToken,
        token: loadDebugConfig(this.options.config.rawYaml).token,
      },
      control: {
        requireToken: loadControlConfig(this.options.config.rawYaml).requireToken,
        token: loadControlConfig(this.options.config.rawYaml).token,
      },
      debugController: this.options.getDebugSnapshot
        ? {
            getSnapshot: this.options.getDebugSnapshot,
          }
        : undefined,
    });
    this.url = await this.renderer.start();
    process.env.LIVE_RENDERER_URL = this.url;
    this.options.logger.info(`Stage Window ready: ${this.url}/live`);
  }

  async stop(): Promise<void> {
    await this.renderer?.stop();
    this.renderer = undefined;
    this.url = undefined;
    this.options.logger.info("Stage Window stopped");
  }

  snapshot() {
    return {
      renderer: this.renderer?.getStatus() ?? { connected: false, url: this.url ?? "" },
      liveUrl: this.url ? `${this.url}/live` : undefined,
    };
  }

  getRendererServer(): LiveRendererServer | undefined {
    return this.renderer;
  }
}
