// === Imports ===
import type { StelleEventBus } from "../../../utils/event_bus.js";
import type { LivePlatformBridge } from "./types.js";

// === Types ===
export interface LivePlatformSupervisorOptions {
  connectTimeoutMs?: number;
  pollIntervalMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
}

// === Main Class ===
/**
 * LivePlatformSupervisor
 *
 * Manages the connection lifecycle of a single LivePlatformBridge.
 * Handles automatic reconnection, backoff, and event publishing.
 */
export class LivePlatformSupervisor {
  private stopped = true;
  private reconnectAttempt = 0;
  private runPromise?: Promise<void>;
  private wake?: () => void;

  constructor(
    private readonly bridge: LivePlatformBridge,
    private readonly eventBus: StelleEventBus,
    private readonly logger: any,
    private readonly options: LivePlatformSupervisorOptions = {},
  ) {}

  // --- Public Control ---

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.runPromise = this.run().finally(() => {
      this.runPromise = undefined;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    await this.bridge.stop();
    await this.runPromise;
  }

  status(): import("./types.js").LivePlatformStatus {
    return this.bridge.status();
  }

  // --- Execution Loop ---

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        if (!this.bridge.status().enabled) {
          this.publishStatus("disabled");
          break;
        }
        this.publishStatus("connecting");
        await withTimeout(this.bridge.start(), this.options.connectTimeoutMs ?? 15_000);
        if (!this.bridge.status().connected) {
          this.publishStatus("idle");
          await this.waitBeforeReconnect();
          continue;
        }
        this.reconnectAttempt = 0;
        this.publishStatus("connected");
        await this.waitUntilDisconnected();
      } catch (error) {
        if (this.stopped) break;
        const message = error instanceof Error ? error.message : String(error);
        this.publishError(message);
        await this.waitBeforeReconnect();
      }
    }
    this.publishStatus("stopped");
  }

  private async waitUntilDisconnected(): Promise<void> {
    while (!this.stopped && this.bridge.status().connected) {
      await this.sleep(this.options.pollIntervalMs ?? 5_000);
    }
  }

  private async waitBeforeReconnect(): Promise<void> {
    this.reconnectAttempt++;
    const baseDelay = Math.min(
      (this.options.initialBackoffMs ?? 1000) * Math.pow(2, this.reconnectAttempt - 1),
      this.options.maxBackoffMs ?? 60_000,
    );
    const jitter = (Math.random() - 0.5) * (this.options.jitterMs ?? 2000);
    const delay = Math.max(0, baseDelay + jitter);

    this.publishStatus("reconnecting");
    await this.sleep(delay);
  }

  // --- Helpers ---

  private publishStatus(state: string): void {
    const status = this.bridge.status();
    this.eventBus.publish({
      type: "live.platform.status_changed",
      source: "live",
      id: `live-platform-status-${status.platform}-${Date.now()}`,
      timestamp: Date.now(),
      payload: {
        platform: status.platform,
        state,
        connected: status.connected,
        authenticated: status.authenticated,
        reconnectAttempt: this.reconnectAttempt,
      },
    } as any);
  }

  private publishError(message: string): void {
    const status = this.bridge.status();
    this.logger.warn?.(`[LivePlatformSupervisor] ${status.platform} error: ${message}`);
    this.eventBus.publish({
      type: "live.platform.error",
      source: "live",
      id: `live-platform-error-${status.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      payload: {
        platform: status.platform,
        error: message,
        reconnectAttempt: this.reconnectAttempt,
        status,
      },
    } as any);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, ms);
      timer.unref?.();
      this.wake = () => {
        clearTimeout(timer);
        if (this.wake) this.wake = undefined;
        resolve();
      };
    });
  }
}

// === Helpers ===
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
