import type { ResourceRef, DataRefKind } from "../protocol/data_ref.js";

export class ResourceRegistry {
  private resources = new Map<string, { ref: ResourceRef; data: Uint8Array | string | object }>();
  private timers = new Map<string, NodeJS.Timeout>();

  put(
    ownerPackageId: string,
    kind: DataRefKind,
    data: Uint8Array | string | object,
    ttlMs: number,
    accessScope: ResourceRef["accessScope"] = "private",
    mediaType?: string,
    metadata?: Record<string, unknown>,
    allowedPackageIds?: string[],
    debugReadable?: boolean,
  ): ResourceRef {
    const id = `res_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    const sizeBytes = this.calculateSize(data);

    const ref: ResourceRef = {
      id,
      kind,
      mediaType,
      ownerPackageId,
      createdAt: Date.now(),
      ttlMs,
      sizeBytes,
      accessScope,
      allowedPackageIds,
      debugReadable,
      metadata,
    };

    this.resources.set(id, { ref, data });

    if (ttlMs > 0) {
      const timer = setTimeout(() => this.release(id), ttlMs);
      this.timers.set(id, timer);
    }

    return ref;
  }

  get(id: string): { ref: ResourceRef; data: Uint8Array | string | object } | undefined {
    const entry = this.resources.get(id);
    if (!entry) return undefined;
    if (entry.ref.ttlMs > 0 && Date.now() - entry.ref.createdAt > entry.ref.ttlMs) {
      this.release(id);
      return undefined;
    }
    return entry;
  }

  listRefs(): ResourceRef[] {
    for (const id of Array.from(this.resources.keys())) {
      this.get(id);
    }
    return Array.from(this.resources.values()).map((entry) => entry.ref);
  }

  release(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.resources.delete(id);
  }

  private calculateSize(data: Uint8Array | string | object): number {
    if (data instanceof Uint8Array) return data.length;
    if (typeof data === "string") return Buffer.byteLength(data, "utf8");
    return Buffer.byteLength(JSON.stringify(data), "utf8");
  }
}
