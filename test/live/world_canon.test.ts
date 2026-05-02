import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorldCanonStore } from "../../src/capabilities/program/stage_director/world_canon.js";

describe("WorldCanonStore", () => {
  it("keeps danmaku proposals out of confirmed canon", async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "stelle-world-canon-")), "canon.json");
    const store = new WorldCanonStore(file);

    const proposal = await store.propose({ title: "档案馆", summary: "观众提出档案馆有管理员" });
    await expect(
      store.add({ title: "违规确认", summary: "输入直接确认", source: "audience_proposal", status: "confirmed" }),
    ).rejects.toThrow();
    const confirmed = await store.updateStatus(proposal.id, "confirmed");

    expect(proposal.status).toBe("proposed");
    expect(confirmed?.status).toBe("confirmed");
  });
});
