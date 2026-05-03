import { z } from "zod";

export const StelleEventSchema = z.object({
  id: z.string(),
  type: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.number(),
  payload: z.unknown().optional(),
  
  // 新增追踪字段
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  cycleId: z.string().optional(),
  watermarks: z.any().optional(),
  dataRefs: z.array(z.any()).optional(),
  
  metadata: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});

export type StelleEvent = z.infer<typeof StelleEventSchema>;
export type StelleEventType = string;
