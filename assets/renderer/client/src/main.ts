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
  widget?: ProgramWidgetName;
  scene?: string;
  background?: string;
}

type ProgramWidgetName =
  | "topic_compass"
  | "chat_cluster"
  | "conclusion_board"
  | "question_queue"
  | "public_memory_wall"
  | "stage_status"
  | "world_canon"
  | "prompt_lab"
  | "anonymous_community_map";

interface TopicState {
  title?: string;
  mode?: string;
  phase?: string;
  currentQuestion?: string;
  nextQuestion?: string;
  clusters?: Array<{ label: string; count: number; representative?: string }>;
  conclusions?: string[];
  pendingQuestions?: string[];
  scene?: string;
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
const programTopicTitle = document.querySelector<HTMLHeadingElement>("#program-topic-title");
const programTopicPhase = document.querySelector<HTMLParagraphElement>("#program-topic-phase");
const programCurrentQuestion = document.querySelector<HTMLParagraphElement>("#program-current-question");
const programNextQuestion = document.querySelector<HTMLParagraphElement>("#program-next-question");
const programClusters = document.querySelector<HTMLOListElement>("#program-clusters");
const programConclusions = document.querySelector<HTMLOListElement>("#program-conclusions");
const programQuestions = document.querySelector<HTMLOListElement>("#program-questions");
const programStageStatus = document.querySelector<HTMLDListElement>("#program-stage-status");
const programPublicMemories = document.querySelector<HTMLOListElement>("#program-public-memories");
const programWorldCanon = document.querySelector<HTMLOListElement>("#program-world-canon");
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
  if (command.type === "topic:update") {
    applyTopicState(asRecord(command.state));
    return;
  }
  if (command.type === "widget:update") {
    applyWidgetState(command.widget, command.state);
    return;
  }
  if (command.type === "scene:set") {
    applyProgramScene(String(command.scene ?? "observation"), typeof command.background === "string" ? command.background : undefined);
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

function applyTopicState(raw: Record<string, unknown>): void {
  const state = raw as TopicState;
  if (programTopicTitle) programTopicTitle.textContent = String(state.title ?? "今日议题");
  if (programTopicPhase) programTopicPhase.textContent = [state.mode, state.phase].filter(Boolean).join(" / ") || "opening";
  if (programCurrentQuestion) programCurrentQuestion.textContent = String(state.currentQuestion ?? "");
  if (programNextQuestion) programNextQuestion.textContent = state.nextQuestion ? `下一问：${state.nextQuestion}` : "";
  if (state.scene) applyProgramScene(String(state.scene));
  renderClusterList(state.clusters ?? []);
  renderTextList(programConclusions, state.conclusions ?? [], "暂未形成结论");
  renderTextList(programQuestions, state.pendingQuestions ?? [], "暂无待回答问题");
}

function applyWidgetState(widget: ProgramWidgetName | undefined, state: unknown): void {
  const raw = asRecord(state);
  if (widget === "topic_compass") applyTopicState(raw);
  if (widget === "chat_cluster") renderClusterList(Array.isArray(raw.clusters) ? raw.clusters as any[] : []);
  if (widget === "conclusion_board") renderTextList(programConclusions, stringArray(raw.conclusions), "暂未形成结论");
  if (widget === "question_queue") renderTextList(programQuestions, stringArray(raw.pendingQuestions), "暂无待回答问题");
  if (widget === "stage_status") renderStageStatus(raw);
  if (widget === "public_memory_wall") renderPublicMemories(raw);
  if (widget === "world_canon") renderWorldCanon(raw);
}

function renderClusterList(clusters: Array<{ label?: string; count?: number; representative?: string }>): void {
  if (!programClusters) return;
  programClusters.innerHTML = "";
  const visible = clusters.filter(item => Number(item.count ?? 0) > 0).slice(0, 6);
  if (!visible.length) {
    appendListItem(programClusters, "等待弹幕采样");
    return;
  }
  for (const cluster of visible) {
    const body = [clusterLabel(String(cluster.label ?? "other")), `${Number(cluster.count ?? 0)} 条`, cluster.representative].filter(Boolean).join(" · ");
    appendListItem(programClusters, body);
  }
}

function renderTextList(target: HTMLOListElement | null, items: string[], emptyText: string): void {
  if (!target) return;
  target.innerHTML = "";
  const visible = items.map(item => item.trim()).filter(Boolean).slice(0, 5);
  if (!visible.length) {
    appendListItem(target, emptyText);
    return;
  }
  for (const item of visible) appendListItem(target, item);
}

function renderStageStatus(raw: Record<string, unknown>): void {
  if (!programStageStatus) return;
  programStageStatus.innerHTML = "";
  const stage = asRecord(raw.stage);
  const health = asRecord(raw.health);
  const entries = {
    stage: String(stage.status ?? asRecord(health.stageOutput).status ?? "unknown"),
    lane: String(stage.lane ?? asRecord(health.stageOutput).currentLane ?? "none"),
    queue: String(asRecord(health.stageOutput).queueLength ?? "0"),
    tts: String(asRecord(health.tts).lastError ? "error" : asRecord(health.tts).lastProvider ?? "idle"),
  };
  for (const [key, value] of Object.entries(entries)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    programStageStatus.append(dt, dd);
  }
}

function renderPublicMemories(raw: Record<string, unknown>): void {
  if (!programPublicMemories) return;
  programPublicMemories.innerHTML = "";
  const memories = Array.isArray(raw.memories) ? raw.memories.slice(0, 6) : [];
  if (!memories.length) {
    appendListItem(programPublicMemories, "暂无公开节目记忆");
    return;
  }
  for (const item of memories) {
    const record = asRecord(item);
    const title = String(record.title ?? "节目记忆");
    const summary = String(record.summary ?? "");
    appendListItem(programPublicMemories, summary ? `${title}：${summary}` : title);
  }
}

function renderWorldCanon(raw: Record<string, unknown>): void {
  if (!programWorldCanon) return;
  programWorldCanon.innerHTML = "";
  const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 6) : [];
  if (!entries.length) {
    appendListItem(programWorldCanon, "暂无世界观条目");
    return;
  }
  for (const item of entries) {
    const record = asRecord(item);
    const status = String(record.status ?? "proposed");
    const title = String(record.title ?? "设定");
    appendListItem(programWorldCanon, `[${status}] ${title}`);
  }
}

function appendListItem(target: HTMLOListElement, text: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  target.append(li);
}

function applyProgramScene(scene: string, background?: string): void {
  document.body.dataset.programScene = scene || "observation";
  if (background) applyBackground(background);
}

function clusterLabel(value: string): string {
  const labels: Record<string, string> = {
    question: "问题",
    opinion: "观点",
    joke: "吐槽",
    setting_suggestion: "设定建议",
    challenge: "挑战",
    other: "其他",
  };
  return labels[value] ?? value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
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
