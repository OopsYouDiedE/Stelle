import { asRecord } from "../../../shared/json.js";
import { mergeRecords } from "../../../core/config/index.js";
import { 
  loadLiveThanksConfig, 
  loadLiveIdleConfig, 
  loadLiveScheduleConfig, 
  type LiveThanksConfig, 
  type LiveIdleConfig, 
  type LiveScheduleConfig 
} from "../../../shared/live_config_schemas.js";

export interface StageDirectorConfig {
  thanks: LiveThanksConfig;
  idle: LiveIdleConfig;
  schedule: LiveScheduleConfig;
}

export function loadStageDirectorConfig(rawYaml: Record<string, unknown> = {}): StageDirectorConfig {
  const cursors = asRecord(rawYaml.cursors);
  const liveCursor = mergeRecords(asRecord(cursors.live), asRecord(cursors.live_danmaku));
  const liveRoot = mergeRecords(asRecord(rawYaml.live), liveCursor);

  const programRoot = asRecord(rawYaml.program);
  const stageDirectorRoot = asRecord(programRoot.stageDirector || programRoot.stage_director);

  return {
    thanks: loadLiveThanksConfig(
      mergeRecords(liveRoot, {
        thanks: mergeRecords(asRecord(liveRoot.thanks), asRecord(stageDirectorRoot.thanks)),
      }),
    ),
    idle: loadLiveIdleConfig(
      mergeRecords(liveRoot, { idle: mergeRecords(asRecord(liveRoot.idle), asRecord(stageDirectorRoot.idle)) }),
    ),
    schedule: loadLiveScheduleConfig(
      mergeRecords(liveRoot, {
        schedule: mergeRecords(asRecord(liveRoot.schedule), asRecord(stageDirectorRoot.schedule)),
      }),
    ),
  };
}
