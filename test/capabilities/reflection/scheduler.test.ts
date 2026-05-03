import { describe, it, expect, vi } from "vitest";
import { ReflectionScheduler } from "../../../src/capabilities/reflection/scheduler.js";

describe("ReflectionScheduler", () => {
  it("should trigger reflection after reaching memory count threshold", () => {
    const policy = {
      minNewMemories: 3,
      minImportanceSum: 100,
      cooldownMs: 0,
      maxReflectionsPerHour: 10,
      requireEvidenceCount: 1,
    };
    const scheduler = new ReflectionScheduler(policy);

    expect(scheduler.onMemoryAdded({ memoryId: "1", importance: 1, agentId: "s" } as any)).toBeNull();
    expect(scheduler.onMemoryAdded({ memoryId: "2", importance: 1, agentId: "s" } as any)).toBeNull();
    
    const job = scheduler.onMemoryAdded({ memoryId: "3", importance: 1, agentId: "s" } as any);
    expect(job).not.toBeNull();
    expect(job?.trigger).toBe("memory_count");
    expect(job?.memoryIds).toEqual(["1", "2", "3"]);
  });

  it("should trigger reflection after reaching importance sum threshold", () => {
    const policy = {
      minNewMemories: 10,
      minImportanceSum: 15,
      cooldownMs: 0,
      maxReflectionsPerHour: 10,
      requireEvidenceCount: 1,
    };
    const scheduler = new ReflectionScheduler(policy);

    expect(scheduler.onMemoryAdded({ memoryId: "1", importance: 10, agentId: "s" } as any)).toBeNull();
    
    const job = scheduler.onMemoryAdded({ memoryId: "2", importance: 5, agentId: "s" } as any);
    expect(job).not.toBeNull();
    expect(job?.trigger).toBe("importance_sum");
    expect(job?.memoryIds).toEqual(["1", "2"]);
  });
});
