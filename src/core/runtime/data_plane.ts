import type { DataPlane as IDataPlane } from "../protocol/component.js";
import type { ResourceRef, StreamRef, DataRefKind } from "../protocol/data_ref.js";
import type { BackpressureStatus, QueueOverflowPolicy } from "../protocol/backpressure.js";
import { ResourceRegistry } from "./resource_registry.js";
import { StreamRegistry } from "./stream_registry.js";
import { ResourceAccessPolicy } from "../security/resource_access_policy.js";

export class DataPlane implements IDataPlane {
  private resources = new ResourceRegistry();
  private streams = new StreamRegistry();
  private policy = new ResourceAccessPolicy();

  async putBlob(input: {
    ownerPackageId: string;
    kind: DataRefKind;
    mediaType?: string;
    data: Uint8Array | string | object;
    ttlMs: number;
    accessScope?: ResourceRef["accessScope"];
    metadata?: Record<string, unknown>;
  }): Promise<ResourceRef> {
    return this.resources.put(
      input.ownerPackageId,
      input.kind,
      input.data,
      input.ttlMs,
      input.accessScope,
      input.mediaType,
      input.metadata,
    );
  }

  async readBlob(ref: ResourceRef, requesterPackageId: string): Promise<Uint8Array | string | object> {
    const entry = this.resources.get(ref.id);
    if (!entry) throw new Error(`Resource ${ref.id} not found or expired`);

    if (!this.policy.canReadResource(entry.ref, requesterPackageId)) {
      throw new Error(`Access denied to resource ${ref.id} for ${requesterPackageId}`);
    }

    return entry.data;
  }

  async release(refId: string, requesterPackageId: string): Promise<void> {
    const entry = this.resources.get(refId);
    if (entry && entry.ref.ownerPackageId !== requesterPackageId) {
      // Only owner can explicitly release before TTL
      throw new Error(`Only owner can release resource ${refId}`);
    }
    this.resources.release(refId);
  }

  async createStream(input: {
    ownerPackageId: string;
    kind: StreamRef["kind"];
    transport?: StreamRef["transport"];
    latestOnly?: boolean;
    ttlMs?: number;
    maxQueueSize?: number;
    overflow?: QueueOverflowPolicy;
    metadata?: Record<string, unknown>;
  }): Promise<StreamRef> {
    return this.streams.create(input);
  }

  async pushStream(streamId: string, chunk: unknown, ownerPackageId: string): Promise<void> {
    const ref = this.streams.getRef(streamId);
    if (ref?.ownerPackageId !== ownerPackageId) {
      throw new Error(`Only owner can push to stream ${streamId}`);
    }
    this.streams.push(streamId, chunk);
  }

  subscribe(streamRef: StreamRef, requesterPackageId: string): AsyncIterable<unknown> {
    if (!this.policy.canSubscribeStream(streamRef, requesterPackageId)) {
      throw new Error(`Access denied to stream ${streamRef.id}`);
    }
    return this.streams.subscribe(streamRef.id);
  }

  listResourceRefs(): ResourceRef[] {
    return this.resources.listRefs();
  }

  listStreamRefs(): StreamRef[] {
    return this.streams.listRefs();
  }

  getBackpressureStatus(streamId: string, consumerId?: string): BackpressureStatus | undefined {
    return this.streams.getBackpressureStatus(streamId, consumerId);
  }
}
