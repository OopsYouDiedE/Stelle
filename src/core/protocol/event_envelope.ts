import type { StateWatermark } from "./state_watermark.js";
import type { DataRef } from "./data_ref.js";

/**
 * 事件信封 (Event Envelope)
 * 所有 Stelle Internal Windows 之间传输的标准消息格式。
 */
export interface EventEnvelope<TName extends string = string, TPayload = unknown> {
  /** 事件唯一 ID */
  id: string;
  /** 事件名称 (如 memory.write.committed) */
  name: TName;
  /** 发生时间戳 (ISO-8601) */
  ts: string;
  /** 事件源 (发送者 ID) */
  source: string;
  
  /** 关联追踪 */
  correlationId: string;
  /** 因果 ID (指向上一个事件) */
  causationId?: string;
  /** 决策循环 ID */
  cycleId?: string;
  
  /** 版本水位 (此事件发生时读取到的状态版本) */
  watermarks?: StateWatermark;
  /** 数据引用 (指向 DataPlane 中的详细内容) */
  dataRefs?: DataRef[];
  
  /** 业务负载 */
  payload: TPayload;
}
