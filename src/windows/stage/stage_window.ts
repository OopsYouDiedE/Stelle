import { LiveRuntime, LocalLiveRendererBridge } from "../../utils/live.js";
import { LiveRendererServer } from "../live/renderer/renderer_server.js";
import type { RuntimeConfig } from "../../config/index.js";

export interface StageWindowOptions {
  config: RuntimeConfig;
  live: LiveRuntime;
  logger: Pick<Console, "info" | "warn" | "error">;
  getDebugSnapshot?: () => Record<string, unknown>;
}

export class StageWindow {
  private renderer?: LiveRendererServer;
  private url?: string;

  constructor(private readonly options: StageWindowOptions) {}

  async start(): Promise<void> {
    this.renderer = new LiveRendererServer({
      host: this.options.config.live.rendererHost,
      port: this.options.config.live.rendererPort,
      debug: {
        enabled: this.options.config.debug.enabled,
        requireToken: this.options.config.debug.requireToken,
        token: this.options.config.debug.token,
      },
      control: {
        requireToken: this.options.config.control.requireToken,
        token: this.options.config.control.token,
      },
      debugController: this.options.getDebugSnapshot
        ? {
            getSnapshot: this.options.getDebugSnapshot,
          }
        : undefined,
    });
    this.url = await this.renderer.start();
    this.options.live.setRendererBridge(new LocalLiveRendererBridge(this.renderer));
    await this.options.live.start();
    process.env.LIVE_RENDERER_URL = this.url;
    this.options.logger.info(`Stage Window ready: ${this.url}/live`);
  }

  async stop(): Promise<void> {
    await this.options.live.stop();
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
}
