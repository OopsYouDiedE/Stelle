import { describe, expect, it } from "vitest";
import { buildAnonymousCommunityMap } from "../../src/live/controller/community_map.js";

describe("AnonymousCommunityMap", () => {
  it("uses only aggregate labels and counts", () => {
    const map = buildAnonymousCommunityMap({
      now: () => 1,
      clusters: [{ label: "question", count: 3, representative: "能不能忘记我？" }],
      samples: [
        { id: "a", source: "bilibili", kind: "danmaku", text: "hello", receivedAt: 1, priority: "low" },
        { id: "b", source: "bilibili", kind: "danmaku", text: "hello", receivedAt: 1, priority: "high" },
      ],
    });

    expect(map.heat[0]).toMatchObject({ label: "question", count: 3, intensity: 100 });
    expect(JSON.stringify(map)).not.toContain("viewer");
  });
});
