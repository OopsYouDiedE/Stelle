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
  | { type: "audio:play"; url: string; text?: string }
  | {
      type: "audio:stream";
      url: string;
      text?: string;
      provider: "kokoro";
      request: Record<string, string | number | boolean>;
    };

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
const audioHint = document.getElementById("audio-hint") as HTMLElement;
const voiceElement = document.getElementById("voice") as HTMLAudioElement;
const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const STREAM_SAMPLE_RATE = 24000;
const WAV_HEADER_BYTES = 44;

let app: PIXI.Application;
let model: Live2DModel | undefined;
let currentModelId = "Hiyori_pro";
let speechUntil = 0;
let manualMouth: number | undefined;
let voice: HTMLAudioElement;
const audioQueue: Extract<LiveRendererCommand, { type: "audio:play" | "audio:stream" }>[] = [];
let audioPlaying = false;
let primingAudio = false;
let retryTimer: number | undefined;
let audioAllowed = false;
let audioContext: AudioContext | undefined;
let streamPlayhead = 0;
let activeStreamAbort: AbortController | undefined;

interface StelleAudioState {
  queued: number;
  playing: boolean;
  playedCount: number;
  activated: boolean;
  lastUrl?: string;
  lastText?: string;
  lastEvent?: string;
  lastError?: string;
  errorName?: string;
  mediaErrorCode?: number;
  mediaErrorMessage?: string;
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
    activated: audioAllowed,
    lastUrl: window.__stelleAudioState?.lastUrl,
    lastText: window.__stelleAudioState?.lastText,
    lastEvent: window.__stelleAudioState?.lastEvent,
    lastError: window.__stelleAudioState?.lastError,
    errorName: window.__stelleAudioState?.errorName,
    mediaErrorCode: window.__stelleAudioState?.mediaErrorCode,
    mediaErrorMessage: window.__stelleAudioState?.mediaErrorMessage,
    ...patch,
  };
  renderAudioHint();
  void reportAudioState(window.__stelleAudioState);
}

function renderAudioHint(): void {
  if (!audioHint) return;
  if (
    window.__stelleAudioState?.activated &&
    (window.__stelleAudioState?.playing ||
      (window.__stelleAudioState?.queued ?? 0) > 0 ||
      window.__stelleAudioState?.lastEvent === "queued" ||
      window.__stelleAudioState?.lastEvent === "play_requested" ||
      window.__stelleAudioState?.lastEvent === "play_resolved" ||
      window.__stelleAudioState?.lastEvent === "play")
  ) {
    audioHint.textContent = "Audio: speaking";
    audioHint.className = "audio-hint audio-hint-speaking";
    return;
  }
  if (window.__stelleAudioState?.activated) {
    audioHint.textContent = "Audio: ready";
    audioHint.className = "audio-hint audio-hint-ready";
    return;
  }
  if (window.__stelleAudioState?.lastEvent === "priming_blocked" || window.__stelleAudioState?.lastEvent === "play_rejected" || window.__stelleAudioState?.lastEvent === "dropped_blocked") {
    audioHint.textContent = "Audio: blocked";
    audioHint.className = "audio-hint audio-hint-blocked";
    return;
  }
  audioHint.textContent = "Audio: checking";
  audioHint.className = "audio-hint audio-hint-pending";
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
  audioContext = createAudioContext();
  updateAudioState({ lastEvent: "priming_requested", activated: false });
  void primeAudioElement();
  window.addEventListener("click", () => {
    if (!audioAllowed) void primeAudioElement();
  });
  voice.addEventListener("play", () => {
    if (primingAudio) return;
    const durationMs = Number.isFinite(voice.duration) ? Math.round(voice.duration * 1000) : 2400;
    speechUntil = performance.now() + Math.max(1400, Math.min(20000, durationMs));
    manualMouth = undefined;
    status.textContent = `Audio playing: ${voice.currentSrc.split("/").pop() ?? voice.currentSrc}`;
    updateAudioState({ playing: true, lastEvent: "play", lastError: undefined });
  });
  voice.addEventListener("ended", () => {
    if (primingAudio) return;
    audioPlaying = false;
    speechUntil = 0;
    manualMouth = 0;
    updateAudioState({ playing: false, lastEvent: "ended", playedCount: (window.__stelleAudioState?.playedCount ?? 0) + 1 });
    void playNextAudio();
  });
  voice.addEventListener("error", () => {
    const mediaError = describeMediaError();
    if (primingAudio) {
      primingAudio = false;
      updateAudioState({ lastEvent: "priming_error", lastError: "audio priming failed", ...mediaError });
      return;
    }
    audioPlaying = false;
    audioQueue.shift();
    updateAudioState({ playing: false, queued: audioQueue.length, lastEvent: "error", lastError: "audio element error", ...mediaError });
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
  if (command.type === "audio:play" || command.type === "audio:stream") {
    if (!audioAllowed) {
      updateAudioState({
        queued: 0,
        playing: false,
        lastEvent: "dropped_blocked",
        lastUrl: command.url,
        lastText: command.text,
        lastError: "audio blocked; dropped incoming chunk",
        errorName: "NotAllowedError",
      });
      return;
    }
    audioQueue.push(command);
    updateAudioState({
      queued: audioQueue.length,
      lastEvent: "queued",
      lastUrl: command.url,
      lastText: command.text,
      lastError: undefined,
      errorName: undefined,
      mediaErrorCode: undefined,
      mediaErrorMessage: undefined,
    });
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
  if (next.type === "audio:stream") {
    await playStreamCommand(next);
    return;
  }
  primingAudio = false;
  voice.loop = false;
  voice.muted = false;
  voice.src = next.url;
  status.textContent = `Audio queued: ${next.url}`;
    updateAudioState({
      queued: audioQueue.length,
      playing: true,
      lastEvent: "play_requested",
      lastUrl: next.url,
      lastText: next.text,
      lastError: undefined,
      errorName: undefined,
      mediaErrorCode: undefined,
      mediaErrorMessage: undefined,
    });
  await voice.play().then(() => {
    audioQueue.shift();
    updateAudioState({
      queued: audioQueue.length,
      playing: true,
      lastEvent: "play_resolved",
      lastError: undefined,
      errorName: undefined,
      mediaErrorCode: undefined,
      mediaErrorMessage: undefined,
    });
  }).catch((error: unknown) => {
    audioPlaying = false;
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : undefined;
    if (error instanceof Error && error.name === "NotAllowedError") {
      audioAllowed = false;
      audioQueue.length = 0;
      status.textContent = `Audio play failed: ${message}`;
      updateAudioState({ queued: 0, playing: false, activated: false, lastEvent: "play_rejected", lastError: message, errorName, ...describeMediaError() });
      return;
    }
    status.textContent = `Audio play failed: ${message}`;
    updateAudioState({ playing: false, lastEvent: "play_rejected", lastError: message, errorName, ...describeMediaError() });
    scheduleAudioRetry();
  });
}

async function playStreamCommand(command: Extract<LiveRendererCommand, { type: "audio:stream" }>): Promise<void> {
  if (!audioContext) {
    audioPlaying = false;
    updateAudioState({ playing: false, lastEvent: "stream_missing_context", lastError: "audio context unavailable" });
    audioQueue.shift();
    void playNextAudio();
    return;
  }
  if (audioContext.state !== "running") {
    audioAllowed = false;
    audioPlaying = false;
    audioQueue.shift();
    updateAudioState({
      queued: audioQueue.length,
      playing: false,
      activated: false,
      lastEvent: "dropped_blocked",
      lastUrl: command.url,
      lastText: command.text,
      lastError: "audio context not running; dropped incoming chunk",
      errorName: "NotAllowedError",
    });
    return;
  }

  const abort = new AbortController();
  activeStreamAbort = abort;
  updateAudioState({
    queued: audioQueue.length,
    playing: true,
    activated: true,
    lastEvent: "stream_requested",
    lastUrl: command.url,
    lastText: command.text,
    lastError: undefined,
    errorName: undefined,
    mediaErrorCode: undefined,
    mediaErrorMessage: undefined,
  });

  try {
    const response = await fetch(command.url, { signal: abort.signal });
    if (!response.ok || !response.body) {
      throw new Error(`stream request failed: ${response.status}`);
    }
    await consumePcmWavStream(response.body, command);
    audioQueue.shift();
    audioPlaying = false;
    updateAudioState({
      queued: audioQueue.length,
      playing: false,
      activated: audioAllowed,
      lastEvent: "stream_finished",
      lastUrl: command.url,
      lastText: command.text,
      lastError: undefined,
    });
    void playNextAudio();
  } catch (error) {
    audioPlaying = false;
    audioQueue.shift();
    const message = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof DOMException && error.name === "AbortError";
    updateAudioState({
      queued: audioQueue.length,
      playing: false,
      activated: audioAllowed,
      lastEvent: aborted ? "stream_aborted" : "stream_error",
      lastUrl: command.url,
      lastText: command.text,
      lastError: aborted ? undefined : message,
      errorName: error instanceof Error ? error.name : undefined,
    });
    if (!aborted) {
      status.textContent = `Audio stream failed: ${message}`;
    }
    void playNextAudio();
  } finally {
    if (activeStreamAbort === abort) activeStreamAbort = undefined;
  }
}

async function consumePcmWavStream(
  body: ReadableStream<Uint8Array>,
  command: Extract<LiveRendererCommand, { type: "audio:stream" }>
): Promise<void> {
  const reader = body.getReader();
  let headerBytes: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let pcmCarry: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let headerDone = false;
  let receivedChunks = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      let chunk = value;
      if (!headerDone) {
        headerBytes = concatUint8(headerBytes, chunk);
        if (headerBytes.byteLength < WAV_HEADER_BYTES) continue;
        chunk = headerBytes.slice(WAV_HEADER_BYTES);
        headerDone = true;
      }
      if (!chunk.byteLength) continue;
      const ready = concatUint8(pcmCarry, chunk);
      const evenLength = ready.byteLength - (ready.byteLength % 2);
      if (evenLength <= 0) {
        pcmCarry = ready;
        continue;
      }
      pcmCarry = ready.slice(evenLength);
      const samples = pcm16ToFloat32(ready.slice(0, evenLength));
      receivedChunks += 1;
      await schedulePcmChunk(samples, command, receivedChunks);
    }
    if (pcmCarry.byteLength) {
      await schedulePcmChunk(pcm16ToFloat32(pcmCarry), command, receivedChunks + 1);
    }
  } finally {
    reader.releaseLock();
  }
}

async function schedulePcmChunk(
  samples: Float32Array<ArrayBufferLike>,
  command: Extract<LiveRendererCommand, { type: "audio:stream" }>,
  receivedChunks: number
): Promise<void> {
  if (!samples.length || !audioContext) return;
  if (audioContext.state !== "running") {
    audioAllowed = false;
    activeStreamAbort?.abort();
    updateAudioState({
      queued: audioQueue.length,
      playing: false,
      activated: false,
      lastEvent: "dropped_blocked",
      lastUrl: command.url,
      lastText: command.text,
      lastError: "audio context stopped while receiving chunk",
      errorName: "NotAllowedError",
    });
    return;
  }

  const audioBuffer = audioContext.createBuffer(1, samples.length, STREAM_SAMPLE_RATE);
  audioBuffer.copyToChannel(new Float32Array(samples), 0);
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  const currentTime = audioContext.currentTime;
  streamPlayhead = Math.max(streamPlayhead, currentTime + 0.01);
  source.start(streamPlayhead);
  streamPlayhead += audioBuffer.duration;
  speechUntil = performance.now() + Math.max(200, Math.round((streamPlayhead - currentTime) * 1000));
  manualMouth = undefined;
  updateAudioState({
    queued: audioQueue.length,
    playing: true,
    activated: true,
    lastEvent: "stream_chunk_received",
    lastUrl: command.url,
    lastText: command.text,
    lastError: undefined,
    errorName: undefined,
    mediaErrorCode: undefined,
    mediaErrorMessage: undefined,
  });
  status.textContent = `Audio streaming: chunk ${receivedChunks}`;
}

async function primeAudioElement(): Promise<void> {
  if (audioContext) {
    try {
      await audioContext.resume();
    } catch {
      // The audio element play() call below still gives us a concrete autoplay error path.
    }
  }
  primingAudio = true;
  voice.muted = true;
  voice.loop = true;
  voice.src = SILENT_WAV_DATA_URL;
  updateAudioState({
    playing: false,
    activated: false,
    lastEvent: "priming_requested",
    lastError: undefined,
    errorName: undefined,
    mediaErrorCode: undefined,
    mediaErrorMessage: undefined,
  });
  try {
    await voice.play();
    audioAllowed = true;
    if (audioContext && audioContext.state === "suspended") {
      await audioContext.resume().catch(() => undefined);
    }
    streamPlayhead = audioContext?.currentTime ?? 0;
    status.textContent = "Audio primed.";
    updateAudioState({
      playing: false,
      activated: true,
      lastEvent: "primed",
      lastError: undefined,
      errorName: undefined,
      mediaErrorCode: undefined,
      mediaErrorMessage: undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    primingAudio = false;
    audioAllowed = false;
    status.textContent = "Audio priming blocked.";
    updateAudioState({
      playing: false,
      activated: false,
      lastEvent: "priming_blocked",
      lastError: `audio priming blocked: ${message}`,
      errorName: error instanceof Error ? error.name : undefined,
      ...describeMediaError(),
    });
  }
}

async function reportAudioState(state?: StelleAudioState): Promise<void> {
  if (!state) return;
  try {
    await fetch("/audio-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
      keepalive: true,
    });
  } catch {
    // Keep local playback independent from diagnostics.
  }
}

function describeMediaError(): Pick<StelleAudioState, "mediaErrorCode" | "mediaErrorMessage"> {
  return {
    mediaErrorCode: voice?.error?.code,
    mediaErrorMessage: voice?.error?.message || undefined,
  };
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

function createAudioContext(): AudioContext | undefined {
  const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return undefined;
  return new AudioContextCtor({ sampleRate: STREAM_SAMPLE_RATE });
}

function concatUint8(left: Uint8Array<ArrayBufferLike>, right: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}

function pcm16ToFloat32(bytes: Uint8Array<ArrayBufferLike>): Float32Array<ArrayBufferLike> {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const low = bytes[index * 2]!;
    const high = bytes[index * 2 + 1]!;
    let value = (high << 8) | low;
    if (value & 0x8000) value = value - 0x10000;
    samples[index] = value / 32768;
  }
  return samples;
}
