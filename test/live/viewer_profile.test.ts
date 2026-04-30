import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ViewerProfileStore } from "../../src/live/controller/viewer_profile.js";
import type { NormalizedLiveEvent } from "../../src/utils/live_event.js";

describe("ViewerProfileStore", () => {
  it("updates, summarizes, and deletes lightweight viewer profiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "stelle-viewers-"));
    const store = new ViewerProfileStore(root);

    await store.updateFromEvent(event("danmaku", "晚上好"));
    await store.updateFromEvent(event("gift", "辣条", { rawType: "gift", amount: 100, currency: "CNY", giftName: "辣条" }));

    const profile = await store.read("bilibili", "42");
    expect(profile?.interactionCount).toBe(2);
    expect(profile?.roles).toContain("gifter");
    expect(profile?.paymentStats.giftCount).toBe(1);

    const summary = await store.summarize("bilibili", "42");
    expect(summary?.displayName).toBe("小星");
    expect(summary?.relationshipHint).toContain("互动 2 次");

    expect(await store.delete("bilibili", "42")).toBe(true);
    expect(await store.read("bilibili", "42")).toBeNull();
  });
});

function event(kind: NormalizedLiveEvent["kind"], text: string, trustedPayment?: NormalizedLiveEvent["trustedPayment"]): NormalizedLiveEvent {
  return {
    id: `${kind}-1`,
    source: "bilibili",
    kind,
    priority: trustedPayment ? "medium" : "low",
    receivedAt: 1_700_000_000_000,
    user: { id: "42", name: "小星" },
    text,
    trustedPayment,
  };
}
