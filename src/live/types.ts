export type Live2DMotionPriority = "idle" | "normal" | "force";

export interface Live2DModelConfig {
  id: string;
  displayName: string;
  dir: string;
  jsonName: string;
  resourcesRoot: string;
  modelJsonPath?: string;
  motions: {
    idle?: string;
    tap?: string;
    tapBody?: string;
    flick?: string;
    flickUp?: string;
    flickDown?: string;
    flickBody?: string;
  };
  hitAreas: {
    head?: string;
    body?: string;
  };
}

export interface Live2DStageState {
  model?: Live2DModelConfig;
  visible: boolean;
  background?: string;
  caption?: string;
  expression?: string;
  lastMotion?: {
    group: string;
    priority: Live2DMotionPriority;
    triggeredAt: number;
  };
  drag?: {
    x: number;
    y: number;
  };
  lastInteraction?: {
    kind: "tap" | "flick" | "drag";
    x: number;
    y: number;
    dx?: number;
    dy?: number;
    timestamp: number;
  };
}

export interface ObsStatus {
  enabled: boolean;
  connected: boolean;
  streaming: boolean;
  currentScene?: string;
  url?: string;
  lastError?: string;
}

export interface LiveRuntimeStatus {
  active: boolean;
  stage: Live2DStageState;
  obs: ObsStatus;
}

export interface LiveActionResult {
  ok: boolean;
  summary: string;
  timestamp: number;
  stage?: Live2DStageState;
  obs?: ObsStatus;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface ObsController {
  getStatus(): Promise<ObsStatus>;
  startStream(): Promise<LiveActionResult>;
  stopStream(): Promise<LiveActionResult>;
  setCurrentScene(sceneName: string): Promise<LiveActionResult>;
}

export type LiveRendererCommand =
  | { type: "state:set"; state: Live2DStageState }
  | { type: "caption:set"; text: string }
  | { type: "caption:clear" }
  | { type: "background:set"; source: string }
  | { type: "model:load"; modelId: string; model?: Live2DModelConfig }
  | { type: "motion:trigger"; group: string; priority: Live2DMotionPriority }
  | { type: "expression:set"; expression: string }
  | { type: "mouth:set"; value: number }
  | { type: "speech:start"; durationMs?: number }
  | { type: "speech:stop" }
  | { type: "audio:play"; url: string; text?: string };

export interface LiveRendererBridge {
  publish(command: LiveRendererCommand): Promise<void> | void;
}
