import type { ResourceRef, StreamRef } from "../protocol/data_ref.js";

export class ResourceAccessPolicy {
  canReadResource(ref: ResourceRef, requesterPackageId: string): boolean {
    if (ref.allowedPackageIds?.includes(requesterPackageId)) return true;
    if (ref.accessScope === "public") return true;
    if (ref.ownerPackageId === requesterPackageId) return true;
    if (ref.accessScope === "runtime") return false;
    if ((ref.accessScope === "debug" || ref.debugReadable) && requesterPackageId === "debug.server") {
      return true;
    }
    return false;
  }

  canSubscribeStream(ref: StreamRef, requesterPackageId: string): boolean {
    if (ref.allowedPackageIds?.includes(requesterPackageId)) return true;
    if (ref.ownerPackageId === requesterPackageId) return true;
    const scope = ref.metadata?.accessScope;
    if (scope === "public") return true;
    if (scope === "runtime") return false;
    if (scope === "debug" || ref.debugReadable) return requesterPackageId === "debug.server";
    return false;
  }
}
