import "./style.css";
import type { Application } from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";
import type { Live2DModelConfig, Live2DStageState, LiveRendererAudioStatus, LiveRendererCommand } from "../../../types.js";
import {
  AUDIO_OWNER_HEARTBEAT_MS,
  AUDIO_OWNER_KEY,
  AUDIO_OWNER_STALE_MS,
  SILENT_WAV_DATA_URL,
  STREAM_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  clamp01,
  concatUint8,
  createAudioContext,
  pcm16ToFloat32,
  readAudioOwnership,
  type StelleAudioState,
  writeAudioOwnership,
} from "./audioShared.js";
import { loadLive2dRuntime, type Live2dRuntime } from "./live2dRuntime.js";

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
const stage = document.getElementById("stage") as HTMLElement;
const background = document.getElementById("background") as HTMLElement;
const caption = document.getElementById("caption-text") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const audioHint = document.getElementById("audio-hint") as HTMLElement;
const voiceElement = document.getElementById("voice") as HTMLAudioElement;

let app: Application;
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
let streamDiscardingBlocked = false;
const audioInstanceId = `audio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let audioOwnershipTimer: number | undefined;
let audioOwner = false;
let live2dRuntime: Live2dRuntime | undefined;

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
  if (!audioOwner) {
    audioHint.textContent = "Audio: passive";
    audioHint.className = "audio-hint audio-hint-pending";
    return;
  }
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
  if (
    window.__stelleAudioState?.lastEvent === "priming_blocked" ||
    window.__stelleAudioState?.lastEvent === "play_rejected" ||
    window.__stelleAudioState?.lastEvent === "dropped_blocked" ||
    window.__stelleAudioState?.lastEvent === "stream_discarding_blocked" ||
    window.__stelleAudioState?.lastEvent === "stream_discarded"
  ) {
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
  live2dRuntime = await loadLive2dRuntime();
  app = new live2dRuntime.PIXI.Application({
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
  startAudioOwnershipLoop();
  updateAudioState({ lastEvent: "priming_requested", activated: false });
  if (audioOwner) void primeAudioElement();
  window.addEventListener("click", () => {
    if (audioOwner && !audioAllowed) void primeAudioElement();
  });
  window.addEventListener("beforeunload", releaseAudioOwnership);
  window.addEventListener("pagehide", releaseAudioOwnership);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshAudioOwnership();
    }
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
  connectEvents();
  try {
    await loadModel(currentModelId);
  } catch (error) {
    status.textContent = `Model load failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  app.ticker.add(updateMouth, undefined, live2dRuntime.PIXI.UPDATE_PRIORITY.LOW);
  window.addEventListener("resize", fitModel);
}

async function loadModel(modelId: string, config?: Live2DModelConfig): Promise<void> {
  if (!live2dRuntime) throw new Error("Live2D runtime not loaded.");
  currentModelId = modelId;
  status.textContent = `Loading ${config?.displayName ?? modelId}...`;
  const modelUrl = modelUrlFor(modelId, config);
  const next = await live2dRuntime.Live2DModel.from(modelUrl, {
    autoInteract: false,
    motionPreload: "IDLE" as never,
    idleMotionGroup: "Idle",
  });
  if (model) app.stage.removeChild(model);
  model = next;
  app.stage.addChild(model);
  fitModel();
  status.textContent = config?.displayName ?? modelId;
  await model.motion("Idle", undefined, live2dRuntime.MotionPriority.IDLE).catch(() => undefined);
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
    if (!audioOwner) {
      updateAudioState({
        queued: 0,
        playing: false,
        activated: false,
        lastEvent: "audio_passive_instance",
        lastUrl: command.url,
        lastText: command.text,
        lastError: "another live renderer tab owns audio playback",
      });
      return;
    }
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
  streamDiscardingBlocked = audioContext.state !== "running";

  const abort = new AbortController();
  activeStreamAbort = abort;
  updateAudioState({
    queued: audioQueue.length,
    playing: !streamDiscardingBlocked,
    activated: !streamDiscardingBlocked,
    lastEvent: streamDiscardingBlocked ? "stream_discarding_blocked" : "stream_requested",
    lastUrl: command.url,
    lastText: command.text,
    lastError: streamDiscardingBlocked ? "audio context not running; discarding streamed chunks after wav header" : undefined,
    errorName: streamDiscardingBlocked ? "NotAllowedError" : undefined,
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
      lastEvent: streamDiscardingBlocked ? "stream_discarded" : "stream_finished",
      lastUrl: command.url,
      lastText: command.text,
      lastError: streamDiscardingBlocked ? "stream consumed without playback because autoplay was blocked" : undefined,
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
    streamDiscardingBlocked = false;
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
      receivedChunks += 1;
      if (streamDiscardingBlocked) {
        updateAudioState({
          queued: audioQueue.length,
          playing: false,
          activated: false,
          lastEvent: "stream_discarding_blocked",
          lastUrl: command.url,
          lastText: command.text,
          lastError: "autoplay blocked; discarding streamed PCM chunks",
          errorName: "NotAllowedError",
        });
        continue;
      }
      const samples = pcm16ToFloat32(ready.slice(0, evenLength));
      await schedulePcmChunk(samples, command, receivedChunks);
    }
    if (pcmCarry.byteLength && !streamDiscardingBlocked) {
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
    streamDiscardingBlocked = true;
    updateAudioState({
      queued: audioQueue.length,
      playing: false,
      activated: false,
      lastEvent: "stream_discarding_blocked",
      lastUrl: command.url,
      lastText: command.text,
      lastError: "audio context stopped while receiving chunk; discarding remaining PCM",
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
  if (!audioOwner) return;
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

function startAudioOwnershipLoop(): void {
  refreshAudioOwnership();
  audioOwnershipTimer = window.setInterval(refreshAudioOwnership, AUDIO_OWNER_HEARTBEAT_MS);
}

function refreshAudioOwnership(): void {
  const current = readAudioOwnership();
  const now = Date.now();
  const stale = !current || now - current.timestamp > AUDIO_OWNER_STALE_MS;
  const shouldOwn =
    stale ||
    current.id === audioInstanceId ||
    (!document.hidden && current.hidden);

  if (shouldOwn) {
    writeAudioOwnership({ id: audioInstanceId, timestamp: now, hidden: document.hidden });
    setAudioOwner(true);
    return;
  }

  setAudioOwner(false);
}

function setAudioOwner(next: boolean): void {
  if (audioOwner === next) return;
  audioOwner = next;
  if (!audioOwner) {
    audioAllowed = false;
    audioPlaying = false;
    audioQueue.length = 0;
    activeStreamAbort?.abort();
    activeStreamAbort = undefined;
    try {
      voice.pause();
    } catch {
      // Ignore media pause failures during ownership handoff.
    }
    voice.removeAttribute("src");
    voice.load();
    updateAudioState({
      queued: 0,
      playing: false,
      activated: false,
      lastEvent: "audio_passive_instance",
      lastError: "another live renderer tab owns audio playback",
    });
    return;
  }

  updateAudioState({
    queued: audioQueue.length,
    playing: false,
    activated: false,
    lastEvent: "audio_owner_acquired",
    lastError: undefined,
  });
  void primeAudioElement();
}

function releaseAudioOwnership(): void {
  if (audioOwnershipTimer !== undefined) {
    window.clearInterval(audioOwnershipTimer);
    audioOwnershipTimer = undefined;
  }
  const current = readAudioOwnership();
  if (current?.id === audioInstanceId) {
    localStorage.removeItem(AUDIO_OWNER_KEY);
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
  if (!model || !live2dRuntime) return;
  const mapped =
    priority === "force"
      ? live2dRuntime.MotionPriority.FORCE
      : priority === "idle"
        ? live2dRuntime.MotionPriority.IDLE
        : live2dRuntime.MotionPriority.NORMAL;
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

