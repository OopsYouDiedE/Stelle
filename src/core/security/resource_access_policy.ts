import type { ResourceRef, StreamRef } from "../protocol/data_ref.js";

export class ResourceAccessPolicy {
  canReadResource(ref: ResourceRef, requesterPackageId: string): boolean {
    if (ref.accessScope === "public") return true;
    if (ref.ownerPackageId === requesterPackageId) return true;
    if (ref.accessScope === "runtime") {
      // Allow kernel or core capabilities to read
      return requesterPackageId.startsWith("capability.cognition") || requesterPackageId.startsWith("core.");
    }
    if (ref.accessScope === "debug" && requesterPackageId === "debug.server") {
      return true;
    }
    return false;
  }

  canSubscribeStream(ref: StreamRef, requesterPackageId: string): boolean {
    if (ref.ownerPackageId === requesterPackageId) return true;
    const scope = ref.metadata?.accessScope;
    if (scope === "public") return true;
    if (scope === "runtime") {
      return requesterPackageId.startsWith("capability.") || requesterPackageId.startsWith("window.");
    }
    if (scope === "debug") return requesterPackageId === "debug.server";
    return false;
  }
}
