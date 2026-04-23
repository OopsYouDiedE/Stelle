import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display/cubism4";
import "./style.css";

type LiveRendererCommand =
  | { type: "state:set"; state: Live2DStageState }
  | { type: "caption:set"; text: string }
  | { type: "caption:clear" }
  | { type: "background:set"; source: string }
  | { type: "model:load"; modelId: string; model?: Live2DModelConfig }
  | { type: "motion:trigger"; group: string; priority?: "idle" | "normal" | "force" }
  | { type: "expression:set"; expression: string }
  | { type: "mouth:set"; value: number }
  | { type: "speech:start"; durationMs?: number }
  | { type: "speech:stop" }
  | { type: "audio:play"; url: string; text?: string };

interface Live2DModelConfig {
  id: string;
  displayName: string;
  dir: string;
  jsonName: string;
}

interface Live2DStageState {
  model?: Live2DModelConfig;
  background?: string;
  caption?: string;
}

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLElement;
const background = document.getElementById("background") as HTMLElement;
const caption = document.getElementById("caption-text") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const voiceElement = document.getElementById("voice") as HTMLAudioElement;
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

let app: PIXI.Application;
let model: Live2DModel | undefined;
let currentModelId = "Hiyori_pro";
let speechUntil = 0;
let manualMouth: number | undefined;
let voice: HTMLAudioElement;
const audioQueue: Extract<LiveRendererCommand, { type: "audio:play" }>[] = [];
let audioPlaying = false;
let primingAudio = false;
let retryTimer: number | undefined;

interface StelleAudioState {
  queued: number;
  playing: boolean;
  playedCount: number;
  lastUrl?: string;
  lastText?: string;
  lastError?: string;
}

declare global {
  interface Window {
    __stelleAudioState?: StelleAudioState;
    __stelleRendererEventsReady?: boolean;
  }
}

function updateAudioState(patch: Partial<StelleAudioState> = {}): void {
  window.__stelleAudioState = {
    queued: audioQueue.length,
    playing: audioPlaying,
    playedCount: window.__stelleAudioState?.playedCount ?? 0,
    lastUrl: window.__stelleAudioState?.lastUrl,
    lastText: window.__stelleAudioState?.lastText,
    lastError: window.__stelleAudioState?.lastError,
    ...patch,
  };
}

updateAudioState();
void boot();

async function boot(): Promise<void> {
  Live2DModel.registerTicker(PIXI.Ticker);
  app = new PIXI.Application({
    view: canvas,
    resizeTo: stage,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  voice = voiceElement;
  voice.crossOrigin = "anonymous";
  voice.preload = "auto";
  voice.autoplay = true;
  updateAudioState();
  void primeAudioElement();
  voice.addEventListener("play", () => {
    if (primingAudio) return;
    const durationMs = Number.isFinite(voice.duration) ? Math.round(voice.duration * 1000) : 2400;
    speechUntil = performance.now() + Math.max(1400, Math.min(20000, durationMs));
    manualMouth = undefined;
    status.textContent = `Audio playing: ${voice.currentSrc.split("/").pop() ?? voice.currentSrc}`;
    updateAudioState({ playing: true, lastError: undefined });
  });
  voice.addEventListener("ended", () => {
    if (primingAudio) return;
    audioPlaying = false;
    speechUntil = 0;
    manualMouth = 0;
    updateAudioState({ playing: false, playedCount: (window.__stelleAudioState?.playedCount ?? 0) + 1 });
    void playNextAudio();
  });
  voice.addEventListener("error", () => {
    if (primingAudio) {
      primingAudio = false;
      updateAudioState({ lastError: "audio priming failed" });
      return;
    }
    audioPlaying = false;
    audioQueue.shift();
    updateAudioState({ playing: false, queued: audioQueue.length, lastError: "audio element error" });
    void playNextAudio();
  });
  await loadModel(currentModelId);
  app.ticker.add(updateMouth, undefined, PIXI.UPDATE_PRIORITY.LOW);
  window.addEventListener("resize", fitModel);
  connectEvents();
}

async function loadModel(modelId: string, config?: Live2DModelConfig): Promise<void> {
  currentModelId = modelId;
  status.textContent = `Loading ${config?.displayName ?? modelId}...`;
  const modelUrl = modelUrlFor(modelId, config);
  const next = await Live2DModel.from(modelUrl, {
    autoInteract: false,
    motionPreload: "IDLE" as never,
    idleMotionGroup: "Idle",
  });
  if (model) app.stage.removeChild(model);
  model = next;
  app.stage.addChild(model);
  fitModel();
  status.textContent = config?.displayName ?? modelId;
  await model.motion("Idle", undefined, MotionPriority.IDLE).catch(() => undefined);
}

function fitModel(): void {
  if (!model) return;
  const width = stage.clientWidth || 1920;
  const height = stage.clientHeight || 1080;
  model.anchor.set(0.5, 0.5);
  model.position.set(width / 2, height * 0.49);
  const scale = Math.min((width * 0.42) / model.width, (height * 0.86) / model.height);
  model.scale.set(Math.max(scale, 0.08));
}

function connectEvents(): void {
  const source = new EventSource("/events");
  source.onopen = () => {
    window.__stelleRendererEventsReady = true;
  };
  source.addEventListener("command", (event) => {
    const command = JSON.parse(event.data) as LiveRendererCommand;
    void applyCommand(command);
  });
  source.onerror = () => {
    status.textContent = "Renderer event stream reconnecting...";
  };
}

async function applyCommand(command: LiveRendererCommand): Promise<void> {
  if (command.type === "state:set") {
    if (command.state.background) setBackground(command.state.background);
    if (command.state.caption !== undefined) caption.textContent = command.state.caption;
    if (command.state.model?.id && command.state.model.id !== currentModelId) await loadModel(command.state.model.id, command.state.model);
  }
  if (command.type === "caption:set") caption.textContent = command.text;
  if (command.type === "caption:clear") caption.textContent = "";
  if (command.type === "background:set") setBackground(command.source);
  if (command.type === "model:load") await loadModel(command.modelId, command.model);
  if (command.type === "motion:trigger") await triggerMotion(command.group, command.priority);
  if (command.type === "expression:set") await model?.expression(command.expression).catch(() => undefined);
  if (command.type === "mouth:set") manualMouth = clamp01(command.value);
  if (command.type === "speech:start") {
    manualMouth = undefined;
    speechUntil = performance.now() + (command.durationMs ?? 2400);
  }
  if (command.type === "speech:stop") {
    speechUntil = 0;
    manualMouth = 0;
  }
  if (command.type === "audio:play") {
    audioQueue.push(command);
    updateAudioState({ queued: audioQueue.length, lastUrl: command.url, lastText: command.text, lastError: undefined });
    void playNextAudio();
  }
}

async function playNextAudio(): Promise<void> {
  if (audioPlaying || !audioQueue.length) return;
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
  const next = audioQueue[0]!;
  audioPlaying = true;
  if (next.text) caption.textContent = next.text;
  primingAudio = false;
  voice.loop = false;
  voice.muted = false;
  voice.src = next.url;
  status.textContent = `Audio queued: ${next.url}`;
  updateAudioState({ queued: audioQueue.length, playing: true, lastUrl: next.url, lastText: next.text, lastError: undefined });
  await voice.play().then(() => {
    audioQueue.shift();
    updateAudioState({ queued: audioQueue.length, playing: true, lastError: undefined });
  }).catch((error: unknown) => {
    audioPlaying = false;
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = `Audio play failed: ${message}. Waiting for OBS/browser autoplay permission.`;
    updateAudioState({ playing: false, lastError: message });
    scheduleAudioRetry();
  });
}

async function primeAudioElement(): Promise<void> {
  primingAudio = true;
  voice.muted = true;
  voice.loop = true;
  voice.src = SILENT_WAV_DATA_URL;
  try {
    await voice.play();
    updateAudioState({ lastError: undefined });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    primingAudio = false;
    updateAudioState({ lastError: `audio priming blocked: ${message}` });
  }
}

function scheduleAudioRetry(): void {
  if (retryTimer !== undefined || !audioQueue.length) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void playNextAudio();
  }, 2500);
}

async function triggerMotion(group: string, priority: "idle" | "normal" | "force" = "normal"): Promise<void> {
  if (!model) return;
  const mapped =
    priority === "force" ? MotionPriority.FORCE : priority === "idle" ? MotionPriority.IDLE : MotionPriority.NORMAL;
  const ok = await model.motion(group, undefined, mapped).catch(() => false);
  if (!ok) {
    status.textContent = `Motion unavailable: ${group}`;
  }
}

function setBackground(source: string): void {
  if (/^(https?:|data:|file:|\/)/.test(source)) {
    background.style.backgroundImage = `url("${source.replace(/"/g, "%22")}")`;
  } else {
    background.style.backgroundImage = source;
  }
}

function updateMouth(): void {
  if (!model) return;
  const coreModel = (model.internalModel as unknown as { coreModel?: { setParameterValueById?: (id: string, value: number, weight?: number) => void } }).coreModel;
  const now = performance.now();
  const speaking = now < speechUntil;
  const value = manualMouth !== undefined ? manualMouth : speaking ? 0.18 + Math.abs(Math.sin(now / 86)) * 0.72 : 0;
  coreModel?.setParameterValueById?.("ParamMouthOpenY", value, 1);
}

function modelUrlFor(modelId: string, config?: Live2DModelConfig): string {
  if (config) return `/Resources/${config.dir}/${config.jsonName}`;
  if (modelId === "Hiyori") return "/Resources/Hiyori/Hiyori.model3.json";
  return "/Resources/Hiyori_pro/hiyori_pro_t11.model3.json";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
