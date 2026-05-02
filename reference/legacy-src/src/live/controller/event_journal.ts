import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { StelleEvent, StelleEventType } from "../../utils/event_schema.js";
import type { StelleEventBus } from "../../utils/event_bus.js";

export interface LiveJournalRecord {
  sessionId: string;
  sequence: number;
  recordedAt: number;
  event: StelleEvent;
}

export interface LiveEventJournalOptions {
  rootDir?: string;
  sessionId?: string;
  eventTypes?: Array<StelleEventType | "*">;
}

export class LiveEventJournal {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly eventPath: string;
  private sequence = 0;
  private unsubscribe?: () => void;
  private writeQueue: Promise<void> = Promise.resolve();
  private recent: LiveJournalRecord[] = [];
  private readonly eventTypes: Set<string>;

  constructor(
    private readonly eventBus: StelleEventBus,
    options: LiveEventJournalOptions = {},
  ) {
    this.sessionId = options.sessionId ?? liveSessionId();
    this.sessionDir = path.resolve(options.rootDir ?? "reference/legacy-src/artifacts/live-sessions", this.sessionId);
    this.eventPath = path.join(this.sessionDir, "events.jsonl");
    this.eventTypes = new Set(options.eventTypes ?? ["*"]);
  }

  async start(): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    this.unsubscribe = this.eventBus.subscribe("*", (event) => {
      if (!this.shouldRecord(event.type)) return;
      return this.record(event).catch((error) => console.warn("[LiveEventJournal] write failed:", error));
    }, { maxPending: 100, dropWhenFull: "oldest" });
  }

  async stop(): Promise<void> {
    await this.eventBus.flushBackpressure("*");
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.writeQueue;
  }

  async record(event: StelleEvent): Promise<void> {
    const record: LiveJournalRecord = {
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      recordedAt: Date.now(),
      event,
    };
    this.recent.push(record);
    if (this.recent.length > 80) this.recent.shift();
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(this.sessionDir, { recursive: true });
      await appendFileWithRetry(this.eventPath, `${JSON.stringify(record)}\n`);
    });
    await this.writeQueue;
  }

  getRecent(limit = 30): LiveJournalRecord[] {
    return this.recent.slice(-Math.max(1, Math.min(100, limit)));
  }

  private shouldRecord(type: string): boolean {
    if (this.eventTypes.has("*")) {
      return type.startsWith("live.") || type.startsWith("stage.output.") || type.startsWith("scene.");
    }
    return this.eventTypes.has(type);
  }
}

export async function readLiveJournal(filePath: string): Promise<LiveJournalRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LiveJournalRecord);
}

function liveSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function appendFileWithRetry(file: string, content: string, attempts = 4): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await appendFile(file, content, "utf8");
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFileLock(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  throw lastError;
}

function isRetryableFileLock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}
