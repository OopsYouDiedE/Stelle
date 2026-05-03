/**
 * 资源租约 (Resource Lease)
 * 用于在多个窗口或能力之间协调对独占资源（如摄像头、麦克风、特定的世界实体）的访问。
 */
export interface ResourceLease {
  leaseId: string;
  resourceId: string;
  ownerId: string; // Holder window/component ID
  expiresAt: string;
  scope: "read" | "write" | "exclusive";
}

export interface LeasePolicy {
  defaultDurationMs: number;
  maxDurationMs: number;
  allowRenewal: boolean;
}
