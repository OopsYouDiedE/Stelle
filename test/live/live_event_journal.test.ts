import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LiveEventJournal, readLiveJournal } from "../../src/live/ops/event_journal.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("LiveEventJournal", () => {
  it("writes live and stage events in replayable order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-live-journal-"));
    const eventBus = new StelleEventBus();
    const journal = new LiveEventJournal(eventBus, { rootDir: root, sessionId: "test-session" });
    await journal.start();

    eventBus.publish({
      type: "live.event.received",
      source: "system",
      id: "live-1",
      timestamp: 1,
      payload: { receivedAt: 1, text: "hello" },
    });
    eventBus.publish({
      type: "live.ingress.dropped",
      source: "system",
      id: "drop-1",
      timestamp: 2,
      payload: { reason: "duplicate" },
    });

    await journal.stop();
    const records = await readLiveJournal(journal.eventPath);

    expect(records.map(record => record.sequence)).toEqual([1, 2]);
    expect(records.map(record => record.event.type)).toEqual(["live.event.received", "live.ingress.dropped"]);
  });
});
