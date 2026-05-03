/**
 * 反思策略 (Reflection Policy)
 * 控制反思的触发阈值和频率。
 */
export interface ReflectionPolicy {
  /** 触发反思所需的新增记忆数量 */
  minNewMemories: number;
  /** 触发反思所需的重要性评分总和 */
  minImportanceSum: number;
  /** 最小触发间隔 (毫秒) */
  cooldownMs: number;
  /** 每小时最大反思次数 */
  maxReflectionsPerHour: number;
  /** 反思必须带有的证据数量 */
  requireEvidenceCount: number;
}

export const DEFAULT_REFLECTION_POLICY: ReflectionPolicy = {
  minNewMemories: 5,
  minImportanceSum: 20,
  cooldownMs: 1000 * 60 * 10, // 10 分钟
  maxReflectionsPerHour: 3,
  requireEvidenceCount: 1,
};
