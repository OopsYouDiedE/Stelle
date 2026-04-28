import { describe, it, expect, vi, beforeEach } from "vitest";
import { StageOutputArbiter } from "../../src/stage/output_arbiter.js";
import type { OutputIntent, StageOutputRenderer } from "../../src/stage/output_types.js";

describe("StageOutputArbiter", () => {
  let arbiter: StageOutputArbiter;
  let mockRenderer: StageOutputRenderer;
  let now = 10000;

  beforeEach(() => {
    mockRenderer = {
      render: vi.fn().mockResolvedValue(undefined),
    };
    arbiter = new StageOutputArbiter({
      renderer: mockRenderer,
      now: () => now,
      maxQueueLength: 5,
    });
  });

  it("should accept and render an intent when idle", async () => {
    const intent: OutputIntent = {
      id: "1",
      cursorId: "test",
      lane: "live_chat",
      priority: 50,
      salience: "medium",
      text: "Hello",
      ttlMs: 5000,
      interrupt: "none",
      output: { caption: true },
    };

    const decision = await arbiter.propose(intent);
    expect(decision.status).toBe("accepted");
    expect(mockRenderer.render).toHaveBeenCalledWith(expect.objectContaining({ id: "1", text: "Hello" }), expect.any(AbortSignal));
  });

  it("should queue intent when busy", async () => {
    // Make renderer slow
    let resolveFirst: (v: void) => void;
    const renderPromise = new Promise<void>((r) => { resolveFirst = r; });
    mockRenderer.render = vi.fn().mockReturnValue(renderPromise);

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Second", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };

    // Propose 1 (will block until resolveFirst)
    const p1 = arbiter.propose(intent1);
    
    // Give it a tick to start
    await new Promise(r => setTimeout(r, 0));
    expect(mockRenderer.render).toHaveBeenCalledTimes(1);

    // Propose 2 (should be queued immediately and return)
    const d2 = await arbiter.propose(intent2);
    expect(d2.status).toBe("queued");
    expect(mockRenderer.render).toHaveBeenCalledTimes(1);

    // Finish first
    resolveFirst!(undefined);
    await p1; // Now p1 should resolve

    // Arbiter uses drain() in finally
    await new Promise(r => setTimeout(r, 10));
    
    expect(mockRenderer.render).toHaveBeenCalledTimes(2);
    expect(mockRenderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ id: "2", text: "Second" }), expect.any(AbortSignal));
  });

  it("should handle hard interrupt with cancellation", async () => {
    let resolveFirst: (v: void) => void;
    let signalCaptured: AbortSignal | undefined;
    
    mockRenderer.render = vi.fn().mockImplementation((intent, signal) => {
      if (intent.id === "1") {
        signalCaptured = signal;
        return new Promise((r) => { resolveFirst = r; });
      }
      return Promise.resolve();
    });

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "emergency", priority: 100, salience: "critical",
      text: "Emergency", ttlMs: 5000, interrupt: "hard", output: { caption: true },
    };

    // Propose 1
    const p1 = arbiter.propose(intent1);
    await new Promise(r => setTimeout(r, 0));
    expect(signalCaptured).toBeDefined();
    expect(signalCaptured?.aborted).toBe(false);

    // Propose 2 (Hard interrupt) - this will trigger abort and then start intent2
    // We don't await it here because start(intent2) will call render(intent2)
    const p2 = arbiter.propose(intent2);
    
    // Propose 2 should trigger abortion of 1 synchronously
    expect(signalCaptured?.aborted).toBe(true);
    
    // Resolve first
    resolveFirst!(undefined);
    await p1; 
    await p2;

    expect(mockRenderer.render).toHaveBeenCalledTimes(2);
    expect(mockRenderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ id: "2" }), expect.any(AbortSignal));
  });

  it("should return queued for soft interrupt when busy (and not abort current)", async () => {
    let resolveFirst: (v: void) => void;
    let signalCaptured: AbortSignal | undefined;
    mockRenderer.render = vi.fn().mockImplementation((intent, signal) => {
      signalCaptured = signal;
      return new Promise((r) => { resolveFirst = r; });
    });

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "ambient", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "direct_response", priority: 60, salience: "medium",
      text: "Soft Interrupt", ttlMs: 5000, interrupt: "soft", output: { caption: true },
    };

    const p1 = arbiter.propose(intent1);
    
    // Wait for it to start
    let attempts = 0;
    while (!arbiter.snapshot().speaking && attempts < 50) {
      await new Promise(r => setTimeout(r, 10));
      attempts++;
    }
    expect(arbiter.snapshot().speaking).toBe(true);

    const d2 = await arbiter.propose(intent2);
    expect(d2.status).toBe("queued");
    
    // Signal should NOT be aborted
    expect(signalCaptured?.aborted).toBe(false);

    resolveFirst!(undefined);
    await p1;
  });

  it("should record interrupted status when hard interrupted", async () => {
    let resolveFirst: (v: void) => void;
    mockRenderer.render = vi.fn().mockImplementation((intent) => {
      if (intent.id === "1") {
        return new Promise((r) => { resolveFirst = r; });
      }
      return Promise.resolve();
    });

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "ambient", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "emergency", priority: 100, salience: "critical",
      text: "Hard", ttlMs: 5000, interrupt: "hard", output: { caption: true },
    };

    await arbiter.propose(intent1);
    await new Promise(r => setTimeout(r, 10)); // Ensure it started
    
    await arbiter.propose(intent2);
    
    // Resolve first (it was aborted)
    resolveFirst!(undefined);
    
    // Wait for the async finally blocks to settle
    await new Promise(r => setTimeout(r, 20));

    const snapshot = arbiter.snapshot();
    const records = snapshot.recentOutputs.filter(r => r.id === "1");
    // Should have at least one record for ID 1, and its status should eventually be interrupted
    const interruptedRecord = records.find(r => r.status === "interrupted");
    expect(interruptedRecord).toBeDefined();
    
    // Total records for ID 1 should be 1 if updated, or more if not. 
    // In our current implementation, record() updates existing by ID.
    expect(records.length).toBe(1);
  });

  it("should hold speaking state for estimatedDuration", async () => {
    mockRenderer.render = vi.fn().mockResolvedValue(undefined);

    const intent: OutputIntent = {
      id: "dur-test", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Hold me", ttlMs: 5000, interrupt: "none", output: { caption: true },
      estimatedDuration: 100, // 100ms
    };

    const p = arbiter.propose(intent);
    await new Promise(r => setTimeout(r, 10));
    
    expect(arbiter.snapshot().speaking).toBe(true);
    
    // Wait for > 100ms
    await new Promise(r => setTimeout(r, 150));
    expect(arbiter.snapshot().speaking).toBe(false);
    
    await p;
  });
});
