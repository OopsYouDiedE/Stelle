import type { StelleEventBus } from "../../utils/event_bus.js";
import type { LivePlatformBridge } from "./types.js";

export interface LivePlatformSupervisorOptions {
  connectTimeoutMs?: number;
  pollIntervalMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
}

export class LivePlatformSupervisor {
  private stopped = true;
  private reconnectAttempt = 0;
  private runPromise?: Promise<void>;

  constructor(
    private readonly bridge: LivePlatformBridge,
    private readonly eventBus: StelleEventBus,
    private readonly logger: Pick<Console, "error" | "warn" | "log"> = console,
    private readonly options: LivePlatformSupervisorOptions = {},
  ) {}

  start(): void {
    if (!this.bridge.status().enabled || this.runPromise) return;
    this.stopped = false;
    this.runPromise = this.run().finally(() => {
      this.runPromise = undefined;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.bridge.stop();
    this.publishStatus("stopped");
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        this.publishStatus("connecting");
        await withTimeout(this.bridge.start(), this.options.connectTimeoutMs ?? 15_000);
        this.reconnectAttempt = 0;
        this.publishStatus("connected");
        await this.waitUntilDisconnected();
        if (!this.stopped) this.publishStatus("disconnected");
      } catch (error) {
        this.publishPlatformError(error);
      }

      if (this.stopped) break;

      const delayMs = this.nextBackoffMs();
      await sleep(delayMs);
    }
  }

  private async waitUntilDisconnected(): Promise<void> {
    const pollIntervalMs = this.options.pollIntervalMs ?? 1_000;
    while (!this.stopped) {
      if (!this.bridge.status().connected) return;
      await sleep(pollIntervalMs);
    }
  }

  private nextBackoffMs(): number {
    const initial = this.options.initialBackoffMs ?? 1_000;
    const max = this.options.maxBackoffMs ?? 30_000;
    const jitterMax = this.options.jitterMs ?? 500;
    const base = Math.min(max, initial * 2 ** this.reconnectAttempt++);
    const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
    return base + jitter;
  }

  private publishStatus(reason: string): void {
    const status = this.bridge.status();
    this.eventBus.publish({
      type: "live.platform.status_changed",
      source: "system",
      id: `live-platform-status-${status.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      payload: {
        platform: status.platform,
        status,
        reason,
        reconnectAttempt: this.reconnectAttempt,
      },
    });
  }

  private publishPlatformError(error: unknown): void {
    const status = this.bridge.status();
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn?.(`[LivePlatformSupervisor] ${status.platform} error: ${message}`);
    this.eventBus.publish({
      type: "live.platform.error",
      source: "system",
      id: `live-platform-error-${status.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      payload: {
        platform: status.platform,
        error: message,
        reconnectAttempt: this.reconnectAttempt,
        status,
      },
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`connect timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
