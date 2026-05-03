import { z } from "zod";

/**
 * 上下文状态 Schema (MVP-1)
 */
export const ContextStateSchema = z.object({
  contextId: z.string(),
  version: z.number(),
  /** 当前活跃话题 */
  activeTopic: z.string().optional(),
  /** 当前活跃任务 */
  activeTask: z.string().optional(),
  /** 情绪暗示 */
  moodHints: z.array(z.string()).optional(),
  /** 舞台/窗口状态 */
  stageState: z.record(z.unknown()).optional(),
  /** 可用能力域 */
  availableDomains: z.array(z.enum(["reply", "world", "stage", "browser", "discord", "memory"])),
});

export type ContextState = z.infer<typeof ContextStateSchema>;
