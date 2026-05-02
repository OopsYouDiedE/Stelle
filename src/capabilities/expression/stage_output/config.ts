import { asRecord, clamp } from "../../../shared/json.js";
import { mergeRecords } from "../../../core/config/index.js";

export interface StageOutputConfig {
  speechQueueLimit: number;
}

export function loadStageOutputConfig(rawYaml: Record<string, unknown> = {}): StageOutputConfig {
  const cursors = asRecord(rawYaml.cursors);
  const liveCursor = mergeRecords(asRecord(cursors.live), asRecord(cursors.live_danmaku));
  
  const expressionRoot = asRecord(rawYaml.expression);
  const stageOutputRoot = asRecord(expressionRoot.stageOutput || expressionRoot.stage_output);

  return {
    speechQueueLimit: clamp(
      process.env.STAGE_OUTPUT_QUEUE_LIMIT ?? stageOutputRoot.speechQueueLimit ?? liveCursor.speechQueueLimit,
      1,
      12,
      3,
    ),
  };
}
