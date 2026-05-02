import { asRecord } from "../../../shared/json.js";

export interface SceneObservationConfig {
  enabled: boolean;
}

export function loadSceneObservationConfig(rawYaml: Record<string, unknown> = {}): SceneObservationConfig {
  const sceneObservation = asRecord(rawYaml.sceneObservation || rawYaml.scene_observation);

  return {
    enabled: sceneObservation.enabled === true || process.env.SCENE_OBSERVATION_ENABLED === "true",
  };
}
