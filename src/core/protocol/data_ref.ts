export type DataRefKind =
  | "text_blob"
  | "json_blob"
  | "image"
  | "audio_chunk"
  | "video_frame"
  | "embedding"
  | "browser_snapshot"
  | "scene_snapshot";

export interface ResourceRef {
  id: string;
  kind: DataRefKind;
  mediaType?: string;
  ownerPackageId: string;
  createdAt: number;
  ttlMs: number;
  sizeBytes?: number;
  checksum?: string;
  accessScope: "private" | "runtime" | "debug" | "public";
  metadata?: Record<string, unknown>;
}

export interface StreamRef {
  id: string;
  kind: "audio_stream" | "video_stream" | "event_stream" | "state_stream";
  ownerPackageId: string;
  createdAt: number;
  transport: "memory_ring" | "message_port" | "websocket" | "file_tail" | "external_url";
  latestOnly: boolean;
  sampleRateHz?: number;
  fps?: number;
  metadata?: Record<string, unknown>;
}

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
  overflow: "drop_oldest" | "drop_newest" | "merge" | "latest_only" | "reject";
  priorityKey?: string;
}
