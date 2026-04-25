/**
 * 模块：JSON 与类型安全 helper
 *
 * 运行逻辑：
 * - LLM 和外部输入都视作 unknown，进入业务层前先通过这些函数收窄。
 * - enum/number/string 都使用安全默认值或 clamp，避免异常形状污染 Cursor 决策。
 *
 * 主要方法：
 * - `asRecord()` / `asString()` / `asStringArray()`：低成本类型收窄。
 * - `enumValue()` / `clamp()`：LLM JSON normalize 常用防线。
 * - `parseJsonObject()`：从 LLM 文本里提取第一个 JSON object。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return asRecord(JSON.parse(normalized));
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return asRecord(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
}
