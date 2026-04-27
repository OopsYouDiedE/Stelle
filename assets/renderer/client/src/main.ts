import "./style.css";
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

interface BilibiliFixture {
  source: string;
  capturedShape: string;
  events: BilibiliFixtureEvent[];
}

const caption = document.querySelector<HTMLHeadingElement>("#caption");
const speaker = document.querySelector<HTMLParagraphElement>("#speaker");
const avatarStatus = document.querySelector<HTMLParagraphElement>("#avatar-status");
const liveCanvas = document.querySelector<HTMLCanvasElement>("#live2d-canvas");
const feed = document.querySelector<HTMLOListElement>("#event-log");
const simulateForm = document.querySelector<HTMLFormElement>("#simulate-form");
const simulateName = document.querySelector<HTMLInputElement>("#simulate-name");
const simulateText = document.querySelector<HTMLInputElement>("#simulate-text");
const simulatePriority = document.querySelector<HTMLSelectElement>("#simulate-priority");
const params = new URLSearchParams(window.location.search);

const defaultSample = "/samples/bilibili-danmu.sample.json";
const avatar = liveCanvas ? new Live2DAvatar({ canvas: liveCanvas, status: avatarStatus }) : null;

let streamToken = 0;
let activeAudio: HTMLAudioElement | null = null;
let autoplayStarted = false;
const pendingAudioQueue: Array<{ url: string }> = [];
let audioPumpRunning = false;

void avatar?.mount().catch(() => undefined);
connectEvents();
bindSimulationForm();

if (shouldAutoplay()) {
  void runAutoplaySample(params.get("sample") || defaultSample);
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
    queueAudio(command.url ?? "");
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

async function runAutoplaySample(sampleUrl: string): Promise<void> {
  try {
    if (autoplayStarted) return;
    autoplayStarted = true;
    const fixture = (await fetch(sampleUrl, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`sample fetch failed: ${response.status}`);
      return response.json();
    })) as BilibiliFixture;

    pushFeed({ lane: "system", text: `loaded ${fixture.events.length} sample events`, userName: "fixture", note: "autoplay" });
    const intervalMs = Math.max(2500, Number(params.get("intervalMs") ?? 6500));
    const loop = !["0", "false", "off"].includes(String(params.get("loop") ?? "0").toLowerCase());

    do {
      for (const event of fixture.events) {
        const text = event.normalized?.text ?? extractDanmakuText(event.raw) ?? `[${event.cmd}]`;
        const name = event.normalized?.userName ?? extractUserName(event.raw) ?? "Bilibili viewer";
        pushFeed({ lane: "incoming", text, userName: name, priority: event.priority, note: event.cmd });
        await postLiveEvent(event);
        await delay(intervalMs);
      }
      if (loop) {
        pushFeed({ lane: "system", text: "fixture loop restart", userName: "fixture", note: "autoplay" });
        await delay(Math.max(1000, intervalMs));
      }
    } while (loop);
  } catch (error) {
    setSpeaker("autoplay failed");
    setCaption(error instanceof Error ? error.message : String(error));
  }
}

async function postLiveEvent(event: BilibiliFixtureEvent): Promise<boolean> {
  try {
    const response = await fetch("/api/live/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
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

function queueAudio(url: string): void {
  if (!url) return;
  pendingAudioQueue.push({ url });
  while (pendingAudioQueue.length > 8) pendingAudioQueue.shift();
  void pumpAudioQueue();
}

async function pumpAudioQueue(): Promise<void> {
  if (audioPumpRunning) return;
  audioPumpRunning = true;
  try {
    while (pendingAudioQueue.length > 0) {
      const next = pendingAudioQueue.shift();
      if (!next) continue;
      await playAudio(next.url);
    }
  } finally {
    audioPumpRunning = false;
  }
}

async function playAudio(url: string): Promise<void> {
  if (!url) return;
  const audio = new Audio(url);
  audio.autoplay = true;
  audio.preload = "auto";
  audio.playsInline = true;
  activeAudio = audio;
  try {
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
        console.warn("live audio element error", url);
        avatar?.stopLipSync();
        reject(new Error(`audio element error: ${url}`));
      }, { once: true });
      audio.play().then(() => {
        console.log("live audio playing", url);
      }).catch(reject);
    });
  } catch (error) {
    console.warn("live audio play failed", error);
    avatar?.stopLipSync();
  } finally {
    if (activeAudio === audio) activeAudio = null;
  }
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

function extractDanmakuText(raw: unknown): string | undefined {
  const info = asRecord(raw).info;
  if (Array.isArray(info) && typeof info[1] === "string") return info[1];
  return undefined;
}

function extractUserName(raw: unknown): string | undefined {
  const info = asRecord(raw).info;
  const user = Array.isArray(info) ? info[2] : undefined;
  return Array.isArray(user) && typeof user[1] === "string" ? user[1] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldAutoplay(): boolean {
  const value = String(params.get("autoplay") ?? "1").toLowerCase();
  return !["0", "false", "off"].includes(value);
}
