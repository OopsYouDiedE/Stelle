import { asRecord, clamp } from "../../shared/json.js";

export interface CoreConfig {
  reflectionIntervalHours: number;
  reflectionAccumulationThreshold: number;
}

export function loadCoreConfig(rawYaml: Record<string, unknown> = {}): CoreConfig {
  const core = asRecord(rawYaml.core);

  return {
    reflectionIntervalHours: clamp(core.reflectionIntervalHours, 1, 168, 6),
    reflectionAccumulationThreshold: clamp(core.reflectionAccumulationThreshold, 1, 10000, 30),
  };
}
