/**
 * 可执行性 (Affordance)
 * 定义一个 Agent 在当前环境下可以执行的特定能力或动作。
 */
export interface Affordance {
  id: string;
  name: string;
  kind: "reply" | "world_action" | "stage_control" | "memory_write" | "tool_call";
  description: string;
  /** 是否可用 */
  isAvailable: boolean;
  /** 不可用原因 */
  reason?: string;
  /** 所需权限或条件 */
  requirements?: string[];
}

/**
 * 能力域 (Capability Domain)
 */
export type CapabilityDomain = "reply" | "world" | "stage" | "browser" | "discord" | "memory";
