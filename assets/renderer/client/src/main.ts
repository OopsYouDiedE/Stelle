/**
 * Module: Browser live stage
 *
 * Runtime flow:
 * 1. Connect to `/events` and consume renderer commands from LiveRuntime.
 * 2. Render `caption:set` immediately and `caption:stream` character by
 *    character for OBS/browser verification.
 * 3. When launched with `?autoplay=1`, load a real Bilibili danmaku fixture,
 *    POST each event to `/api/live/event`, and show the route result.
 *
 * Main methods:
 * - `applyCommand()`: command router for SSE and local autoplay.
 * - `streamCaption()`: cancellable text streaming renderer.
 * - `runAutoplaySample()`: local fixture player for first-stage live tests.
 */
import "./style.css";

interface RendererCommand {
  type?: string;
  text?: string;
  speaker?: string;
  rateMs?: number;
  state?: { caption?: string; speaker?: string };
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
const eventLog = document.querySelector<HTMLOListElement>("#event-log");
const params = new URLSearchParams(window.location.search);
const defaultSample = "/samples/bilibili-danmu.sample.json";

let streamToken = 0;

connectEvents();

if (params.get("autoplay") === "1" || params.get("autoplay") === "true") {
  void runAutoplaySample(params.get("sample") || defaultSample);
}

function connectEvents(): void {
  const events = new EventSource("/events");
  events.addEventListener("command", (event) => {
    applyCommand(JSON.parse(event.data) as RendererCommand);
  });
  events.addEventListener("error", () => {
    setSpeaker("event stream reconnecting");
  });
}

function applyCommand(command: RendererCommand): void {
  if (command.type === "caption:set") {
    setCaption(command.text ?? "");
    setSpeaker(command.speaker ?? "runtime");
    return;
  }
  if (command.type === "caption:stream") {
    void streamCaption(command.text ?? "", command.speaker ?? "runtime", command.rateMs);
    return;
  }
  if (command.type === "route:decision") {
    const route = command as RendererCommand & { eventId?: string; action?: string; reason?: string; userName?: string };
    pushEventLog(`route ${route.action ?? "unknown"} · ${route.userName ?? "viewer"} · ${route.reason ?? route.eventId ?? ""}`);
    return;
  }
  if (command.type === "state:set") {
    setCaption(command.state?.caption ?? "Renderer ready.");
    setSpeaker(command.state?.speaker ?? "runtime state");
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
    const fixture = (await fetch(sampleUrl, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error(`sample fetch failed: ${response.status}`);
      return response.json();
    })) as BilibiliFixture;

    setSpeaker("autoplay fixture");
    pushEventLog(`loaded ${fixture.events.length} real-shape danmaku sample(s)`);

    const intervalMs = Math.max(300, Number(params.get("intervalMs") ?? 1300));
    const rateMs = Math.max(10, Number(params.get("rateMs") ?? 32));

    for (const event of fixture.events) {
      const text = event.normalized?.text ?? extractDanmakuText(event.raw) ?? `[${event.cmd}]`;
      const name = event.normalized?.userName ?? extractUserName(event.raw) ?? "Bilibili viewer";
      pushEventLog(`${event.cmd} · ${name}: ${text}`);
      const routed = await postLiveEvent(event);
      if (!routed) await streamCaption(text, name, rateMs);
      await delay(intervalMs);
    }

    setSpeaker("autoplay finished");
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
      body: JSON.stringify({ ...event, source: "fixture", captionOnly: true, debugVisible: true }),
    });
    if (!response.ok) {
      pushEventLog(`backend unavailable · ${response.status}`);
      return false;
    }
    const json = (await response.json()) as { result?: { reason?: string; summary?: string } };
    pushEventLog(`backend accepted · ${json.result?.reason ?? json.result?.summary ?? "ok"}`);
    return true;
  } catch {
    pushEventLog("backend unavailable · local replay");
    return false;
  }
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

function pushEventLog(text: string): void {
  if (!eventLog) return;
  const item = document.createElement("li");
  item.textContent = text;
  eventLog.prepend(item);
  while (eventLog.children.length > 8) eventLog.lastElementChild?.remove();
}

function setCaption(text: string): void {
  if (caption) caption.textContent = text || " ";
}

function setSpeaker(text: string): void {
  if (speaker) speaker.textContent = text;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
