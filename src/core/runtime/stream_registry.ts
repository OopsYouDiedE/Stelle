import type { StreamRef } from "../protocol/data_ref.js";
import type { BackpressureStatus, QueueOverflowPolicy } from "../protocol/backpressure.js";
import { EventEmitter } from "node:events";

export class StreamRegistry {
  private streams = new Map<
    string,
    {
      ref: StreamRef;
      emitter: EventEmitter;
      lastChunk?: unknown;
      queue: unknown[];
      maxQueueSize: number;
      overflow: QueueOverflowPolicy;
      droppedItems: number;
      createdAt: number;
      ttlMs?: number;
      timer?: NodeJS.Timeout;
    }
  >();

  create(input: {
    ownerPackageId: string;
    kind: StreamRef["kind"];
    transport?: StreamRef["transport"];
    latestOnly?: boolean;
    ttlMs?: number;
    maxQueueSize?: number;
    overflow?: QueueOverflowPolicy;
    metadata?: Record<string, unknown>;
  }): StreamRef {
    const id = `str_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    const ref: StreamRef = {
      id,
      kind: input.kind,
      ownerPackageId: input.ownerPackageId,
      createdAt: Date.now(),
      transport: input.transport || "memory_ring",
      latestOnly: !!input.latestOnly,
      metadata: input.metadata,
    };

    const entry = {
      ref,
      emitter: new EventEmitter(),
      queue: [] as unknown[],
      maxQueueSize: input.maxQueueSize ?? (input.latestOnly ? 1 : 32),
      overflow: input.overflow ?? (input.latestOnly ? "latest_only" : "drop_oldest"),
      droppedItems: 0,
      createdAt: Date.now(),
      ttlMs: input.ttlMs,
      timer: undefined as NodeJS.Timeout | undefined,
    };
    if (input.ttlMs && input.ttlMs > 0) {
      entry.timer = setTimeout(() => this.release(id), input.ttlMs);
    }
    this.streams.set(id, entry);
    return ref;
  }

  push(streamId: string, chunk: unknown): void {
    const entry = this.streams.get(streamId);
    if (entry) {
      if (entry.ref.latestOnly || entry.overflow === "latest_only") {
        entry.lastChunk = chunk;
        entry.queue = [chunk];
      } else if (entry.queue.length >= entry.maxQueueSize) {
        if (entry.overflow === "reject" || entry.overflow === "drop_newest") {
          entry.droppedItems += 1;
          return;
        }
        if (entry.overflow === "drop_oldest" || entry.overflow === "merge") {
          entry.queue.shift();
          entry.droppedItems += 1;
        }
        entry.queue.push(chunk);
      } else {
        entry.queue.push(chunk);
      }
      entry.emitter.emit("chunk", chunk);
    }
  }

  async *subscribe(streamId: string): AsyncIterableIterator<unknown> {
    const entry = this.streams.get(streamId);
    if (!entry) throw new Error(`Stream ${streamId} not found`);

    const emitter = entry.emitter;
    const queue: unknown[] = entry.ref.latestOnly ? [] : [...entry.queue];

    if (entry.ref.latestOnly && entry.lastChunk !== undefined) {
      queue.push(entry.lastChunk);
    }

    let resolve: ((value: any) => void) | null = null;

    const handler = (chunk: unknown) => {
      if (entry.ref.latestOnly) {
        queue.length = 0;
      }
      queue.push(chunk);
      if (resolve) {
        const next = queue.shift();
        resolve(next);
        resolve = null;
      }
    };

    emitter.on("chunk", handler);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift();
        } else {
          yield await new Promise<unknown>((res) => {
            resolve = res;
          });
        }
      }
    } finally {
      emitter.off("chunk", handler);
    }
  }
  getRef(id: string): StreamRef | undefined {
    return this.streams.get(id)?.ref;
  }

  listRefs(): StreamRef[] {
    return Array.from(this.streams.values()).map((entry) => entry.ref);
  }

  getBackpressureStatus(streamId: string, consumerId = "stream.consumer"): BackpressureStatus | undefined {
    const entry = this.streams.get(streamId);
    if (!entry) return undefined;
    const lagMs = entry.lastChunk === undefined ? 0 : Math.max(0, Date.now() - entry.createdAt);
    return {
      streamId,
      consumerId,
      bufferedItems: entry.queue.length,
      droppedItems: entry.droppedItems,
      lagMs,
      recommendedAction:
        entry.ref.latestOnly || entry.overflow === "latest_only"
          ? "latest_only"
          : entry.queue.length >= entry.maxQueueSize
            ? "slow_down"
            : "ok",
    };
  }

  release(id: string): void {
    const entry = this.streams.get(id);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.emitter.removeAllListeners();
      this.streams.delete(id);
    }
  }
}
