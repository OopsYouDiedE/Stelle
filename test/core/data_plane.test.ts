import { describe, expect, it, vi } from "vitest";
import { DataPlane } from "../../src/core/runtime/data_plane.js";

describe("DataPlane", () => {
  it("should store and retrieve blobs", async () => {
    const dp = new DataPlane();
    const data = { hello: "world" };

    const ref = await dp.putBlob({
      ownerPackageId: "test.owner",
      kind: "json_blob",
      data,
      ttlMs: 1000,
    });

    expect(ref.ownerPackageId).toBe("test.owner");
    expect(ref.sizeBytes).toBeGreaterThan(0);

    const retrieved = await dp.readBlob(ref, "test.owner");
    expect(retrieved).toEqual(data);
  });

  it("should respect TTL for blobs", async () => {
    vi.useFakeTimers();
    const dp = new DataPlane();

    const ref = await dp.putBlob({
      ownerPackageId: "test.owner",
      kind: "text_blob",
      data: "short lived",
      ttlMs: 100,
    });

    vi.advanceTimersByTime(150);

    await expect(dp.readBlob(ref, "test.owner")).rejects.toThrow(/not found or expired/);
    vi.useRealTimers();
  });

  it("should handle streams", async () => {
    const dp = new DataPlane();
    const streamRef = await dp.createStream({
      ownerPackageId: "test.owner",
      kind: "event_stream",
      metadata: { accessScope: "public" },
    });

    const subscription = dp.subscribe(streamRef, "test.subscriber");
    const iterator = subscription[Symbol.asyncIterator]();

    // Start the iterator to ensure handler is attached
    const nextPromise = iterator.next();

    await dp.pushStream(streamRef.id, "chunk1", "test.owner");

    const result1 = await nextPromise;
    expect(result1.value).toBe("chunk1");

    await dp.pushStream(streamRef.id, "chunk2", "test.owner");
    const result2 = await iterator.next();
    expect(result2.value).toBe("chunk2");

    if (iterator.return) await iterator.return();
  });

  it("should enforce latestOnly for streams", async () => {
    const dp = new DataPlane();
    const streamRef = await dp.createStream({
      ownerPackageId: "test.owner",
      kind: "video_frame",
      latestOnly: true,
      metadata: { accessScope: "public" },
    });

    await dp.pushStream(streamRef.id, "frame1", "test.owner");
    await dp.pushStream(streamRef.id, "frame2", "test.owner");

    const subscription = dp.subscribe(streamRef, "test.subscriber");
    const reader = subscription[Symbol.asyncIterator]();

    // In latestOnly, frame1 should have been dropped
    const result = await reader.next();
    expect(result.value).toBe("frame2");
  });

  it("should expose metadata without reading private resource content", async () => {
    const dp = new DataPlane();
    const ref = await dp.putBlob({
      ownerPackageId: "window.browser",
      kind: "image",
      mediaType: "image/png",
      data: new Uint8Array([1, 2, 3]),
      ttlMs: 1000,
      accessScope: "private",
    });

    expect(dp.listResourceRefs()).toEqual([ref]);
    await expect(dp.readBlob(ref, "debug.server")).rejects.toThrow(/Access denied/);
  });

  it("should report stream backpressure and dropped frames", async () => {
    const dp = new DataPlane();
    const streamRef = await dp.createStream({
      ownerPackageId: "window.browser",
      kind: "video_stream",
      latestOnly: true,
      metadata: { accessScope: "public" },
    });

    await dp.pushStream(streamRef.id, "frame1", "window.browser");
    await dp.pushStream(streamRef.id, "frame2", "window.browser");

    const status = dp.getBackpressureStatus(streamRef.id, "capability.scene_observation");
    expect(status?.recommendedAction).toBe("latest_only");
    expect(status?.bufferedItems).toBe(1);
  });
});
