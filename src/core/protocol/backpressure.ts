export type QueueOverflowPolicy = "drop_oldest" | "drop_newest" | "merge" | "latest_only" | "reject";

export interface BackpressureStatus {
  streamId?: string;
  queueId?: string;
  consumerId: string;
  bufferedItems: number;
  droppedItems: number;
  lagMs: number;
  recommendedAction: "ok" | "slow_down" | "sample" | "drop_low_priority" | "latest_only";
}

export interface PackageBackpressurePolicy {
  maxQueueSize: number;
  overflow: QueueOverflowPolicy;
  priorityKey?: string;
}
