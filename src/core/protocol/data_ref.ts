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
  allowedPackageIds?: string[];
  debugReadable?: boolean;
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
  allowedPackageIds?: string[];
  debugReadable?: boolean;
}

/**
 * 数据引用 (Data Ref)
 * 用于在事件中安全地引用 DataPlane 中的版本化数据。
 */
export interface DataRef<TKind extends string = string> {
  kind: TKind;
  uri: string;
  version?: number;
  sha256?: string;
}

/**
 * 证据引用 (Evidence Ref)
 * 用于指向支撑某一决策或记忆的证据（如事件 ID、消息 ID 或数据快照）。
 */
export interface EvidenceRef extends DataRef {
  /** 证据描述或片段 */
  summary?: string;
}

/**
 * 实体引用 (Entity Ref)
 * 用于指向世界中的特定对象。
 */
export interface EntityRef {
  kind: string;
  id: string;
}
