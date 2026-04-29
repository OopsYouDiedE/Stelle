import "./style.css";
import { io } from "socket.io-client";
import { Live2DAvatar } from "./live2d";

interface RendererCommand {
  type?: string;
  text?: string;
  speaker?: string;
  rateMs?: number;
  state?: { caption?: string; speaker?: string; background?: string };
  lane?: "incoming" | "response" | "topic" | "system";
  userName?: string;
  priority?: "low" | "medium" | "high";
  note?: string;
  url?: string;
  expression?: string;
  group?: string;
  source?: string;
  status?: string;
  provider?: string;
}

interface BilibiliFixtureEvent {
  id: string;
  cmd: string;
  priority: "low" | "medium" | "high";
  receivedAt: string;
  raw: unknown;
  normalized?: {
    userId?: number | string;
    userName?: string;
    text?: string;
    eventType?: string;
  };
}

const caption = document.querySelector<HTMLHeadingElement>("#caption");
const speaker = document.querySelector<HTMLParagraphElement>("#speaker");
const avatarStatus = document.querySelector<HTMLParagraphElement>("#avatar-status");
const audioStatus = document.querySelector<HTMLParagraphElement>("#audio-status");
const liveCanvas = document.querySelector<HTMLCanvasElement>("#live2d-canvas");
const feed = document.querySelector<HTMLOListElement>("#event-log");
const simulateForm = document.querySelector<HTMLFormElement>("#simulate-form");
const simulateName = document.querySelector<HTMLInputElement>("#simulate-name");
const simulateText = document.querySelector<HTMLInputElement>("#simulate-text");
const simulatePriority = document.querySelector<HTMLSelectElement>("#simulate-priority");
const params = new URLSearchParams(window.location.search);

const avatar = liveCanvas ? new Live2DAvatar({ canvas: liveCanvas, status: avatarStatus }) : null;
const standaloneScene = shouldUseStandaloneScene();

let streamToken = 0;
let activeAudio: HTMLAudioElement | null = null;
const pendingAudioQueue: Array<{ url: string; text?: string; speaker?: string; rateMs?: number }> = [];
let audioPumpRunning = false;

applySceneMode();
void avatar?.mount().catch(() => undefined);
connectEvents();
bindSimulationForm();

if (shouldAutoplay()) {
  primeAutoplayAudio();
}

function connectEvents(): void {
  const socket = io();
  socket.on("command", (command: RendererCommand) => {
    applyCommand(command);
  });
  socket.on("connect_error", () => setSpeaker("socket reconnecting"));
  socket.on("disconnect", () => setSpeaker("socket disconnected"));
}

function bindSimulationForm(): void {
  simulateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const userName = simulateName?.value.trim() || "Test Viewer";
    const text = simulateText?.value.trim() || "";
    const priority = (simulatePriority?.value || "low") as "low" | "medium" | "high";
    if (!text) return;
    pushFeed({
      lane: "incoming",
      text,
      userName,
      priority,
      note: "manual simulate",
    });
    void postLiveEvent({
      id: `manual-${Date.now()}`,
      cmd: "DANMU_MSG",
      priority,
      receivedAt: new Date().toISOString(),
      raw: { info: [[], text, [Date.now(), userName]] },
      normalized: { text, userName, eventType: "danmaku" },
    });
    if (simulateText) simulateText.value = "";
  });
}

function applyCommand(command: RendererCommand): void {
  if (command.type === "caption:set") {
    setCaption(command.text ?? "");
    setSpeaker(command.speaker ?? "runtime");
    return;
  }
  if (command.type === "caption:clear") {
    setCaption("");
    return;
  }
  if (command.type === "caption:stream") {
    void streamCaption(command.text ?? "", command.speaker ?? "runtime", command.rateMs);
    return;
  }
  if (command.type === "background:set") {
    applyBackground(String(command.source ?? ""));
    return;
  }
  if (command.type === "route:decision") {
    pushFeed({
      lane: "system",
      text: command.text ?? command.reason ?? "route decision",
      userName: command.userName ?? "router",
      priority: command.priority,
      note: command.reason ?? "route decision",
    });
    return;
  }
  if (command.type === "event:push") {
    pushFeed({
      lane: command.lane ?? "system",
      text: command.text ?? "",
      userName: command.userName ?? "system",
      priority: command.priority,
      note: command.note,
    });
    return;
  }
  if (command.type === "motion:trigger") {
    void avatar?.triggerMotion(command.group ?? "Idle", "force").catch(() => undefined);
    return;
  }
  if (command.type === "expression:set") {
    void avatar?.setExpression(command.expression ?? "").catch(() => undefined);
    return;
  }
  if (command.type === "audio:play" || command.type === "audio:stream") {
    queueAudio(command.url ?? "", { text: command.text, speaker: command.speaker, rateMs: command.rateMs });
    return;
  }
  if (command.type === "audio:stop") {
    stopAudioPlayback();
    return;
  }
  if (command.type === "audio:status") {
    setAudioStatus([command.provider, command.status].filter(Boolean).join(" ") || "audio idle");
    return;
  }
  if (command.type === "state:set") {
    setCaption(command.state?.caption ?? "Renderer ready.");
    setSpeaker(command.state?.speaker ?? "runtime state");
    if (command.state?.background) applyBackground(command.state.background);
  }
}

async function streamCaption(text: string, source: string, rateMs = 34): Promise<void> {
  const token = ++streamToken;
  setSpeaker(source);
  setCaption("");
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    if (token !== streamToken) return;
    setCaption(chars.slice(0, index + 1).join(""));
    await delay(rateMs);
  }
}

async function postLiveEvent(event: BilibiliFixtureEvent): Promise<boolean> {
  try {
    const token = params.get("controlToken") || params.get("token");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch("/api/live/event", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...event, source: "fixture", captionOnly: false, debugVisible: true }),
    });
    if (!response.ok) {
      pushFeed({ lane: "system", text: `backend unavailable ${response.status}`, userName: "runtime" });
      return false;
    }
    return true;
  } catch {
    pushFeed({ lane: "system", text: "backend unavailable, local only", userName: "runtime" });
    return false;
  }
}

function queueAudio(url: string, sync?: { text?: string; speaker?: string; rateMs?: number }): void {
  if (!url) return;
  pendingAudioQueue.push({ url, ...sync });
  while (pendingAudioQueue.length > 3) pendingAudioQueue.shift();
  void pumpAudioQueue();
}

async function pumpAudioQueue(): Promise<void> {
  if (audioPumpRunning) return;
  audioPumpRunning = true;
  try {
    while (pendingAudioQueue.length > 0) {
      const next = pendingAudioQueue.shift();
      if (!next) continue;
      await playAudio(next);
    }
  } finally {
    audioPumpRunning = false;
  }
}

async function playAudio(item: { url: string; text?: string; speaker?: string; rateMs?: number }): Promise<void> {
  if (!item.url) return;
  const audio = new Audio(item.url);
  audio.autoplay = true;
  audio.preload = "auto";
  audio.playsInline = true;
  activeAudio = audio;
  try {
    setAudioStatus("audio loading");
    if (item.text?.trim()) {
      streamToken += 1;
      setSpeaker(item.speaker ?? "Stelle");
      setCaption(" ");
    }
    await avatar?.startLipSync(audio);
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => {
        avatar?.stopLipSync();
        resolve();
      }, { once: true });
      audio.addEventListener("pause", () => {
        avatar?.stopLipSync();
        resolve();
      }, { once: true });
      audio.addEventListener("error", () => {
        console.warn("live audio element error", item.url);
        avatar?.stopLipSync();
        reject(new Error(`audio element error: ${item.url}`));
      }, { once: true });
      audio.play().then(() => {
        setAudioStatus("audio playing");
        startSyncedCaption(item, audio);
        console.log("live audio playing", item.url);
      }).catch(reject);
    });
  } catch (error) {
    console.warn("live audio play failed", error);
    avatar?.stopLipSync();
  } finally {
    if (activeAudio === audio) activeAudio = null;
    setAudioStatus(pendingAudioQueue.length > 0 ? "audio queued" : "audio idle");
  }
}

function startSyncedCaption(item: { text?: string; speaker?: string; rateMs?: number }, audio: HTMLAudioElement): void {
  const text = item.text?.trim();
  if (!text) return;
  const chars = [...text].length || 1;
  const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : undefined;
  const rateMs = durationMs ? clamp(Math.floor(durationMs / chars), 22, 90) : item.rateMs;
  void streamCaption(text, item.speaker ?? "Stelle", rateMs);
}

function stopAudioPlayback(): void {
  streamToken += 1;
  pendingAudioQueue.length = 0;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  avatar?.stopLipSync();
  setAudioStatus("audio stopped");
}

function pushFeed(item: {
  lane: "incoming" | "response" | "topic" | "system";
  text: string;
  userName?: string;
  priority?: "low" | "medium" | "high";
  note?: string;
}): void {
  if (!feed || !item.text.trim()) return;
  const li = document.createElement("li");
  li.className = `feed-item lane-${item.lane} priority-${item.priority ?? "low"}`;

  const meta = document.createElement("div");
  meta.className = "feed-meta";
  meta.textContent = [item.userName ?? "system", item.note].filter(Boolean).join(" · ");

  const body = document.createElement("div");
  body.className = "feed-text";
  body.textContent = item.text;

  li.append(meta, body);
  feed.append(li);
  while (feed.children.length > 24) feed.firstElementChild?.remove();
  feed.scrollTop = feed.scrollHeight;
}

function applyBackground(source: string): void {
  if (!source) return;
  document.documentElement.style.setProperty("--stage-background-image", `url("${source}")`);
}

function setCaption(text: string): void {
  if (caption) caption.textContent = text || " ";
}

function setSpeaker(text: string): void {
  if (speaker) speaker.textContent = text;
}

function setAudioStatus(text: string): void {
  if (audioStatus) audioStatus.textContent = text;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shouldAutoplay(): boolean {
  const value = String(params.get("autoplay") ?? "0").toLowerCase();
  return !["0", "false", "off"].includes(value);
}

function shouldUseStandaloneScene(): boolean {
  const panel = String(params.get("panel") ?? "0").toLowerCase();
  if (!["0", "false", "off"].includes(panel)) return false;
  return location.pathname === "/live" || location.pathname === "/" || params.get("view") === "stage";
}

function applySceneMode(): void {
  if (standaloneScene) {
    document.body.dataset.scene = "standalone";
    setSpeaker("Stelle");
    setAudioStatus(shouldAutoplay() ? "autoplay ready" : "audio idle");
  }
  if (shouldAutoplay()) {
    document.body.dataset.autoplay = "true";
  }
}

function primeAutoplayAudio(): void {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    const context = AudioContextCtor ? new AudioContextCtor() : undefined;
    void context?.resume().catch(() => undefined);
  } catch {
    // Browser autoplay policy may still require the launch flag; playback will report blocked if so.
  }
}
