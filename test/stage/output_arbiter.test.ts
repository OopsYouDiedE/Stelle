import { describe, it, expect, vi, beforeEach } from "vitest";
import { StageOutputArbiter } from "../../src/actuator/output_arbiter.js";
import type { OutputIntent, StageOutputRenderer } from "../../src/stage/output_types.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("StageOutputArbiter", () => {
  let arbiter: StageOutputArbiter;
  let mockRenderer: StageOutputRenderer;
  let now = 10000;

  beforeEach(() => {
    mockRenderer = {
      render: vi.fn().mockResolvedValue(undefined),
      stopCurrentOutput: vi.fn().mockResolvedValue(undefined),
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
      estimatedDurationMs: 0,
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Second", ttlMs: 5000, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 0,
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
    expect(mockRenderer.stopCurrentOutput).toHaveBeenCalled();
  });

  it("awaits hard interrupt stop before starting replacement output", async () => {
    const order: string[] = [];
    let resolveFirst: (v: void) => void;
    let resolveStop: (v: void) => void;

    mockRenderer.render = vi.fn().mockImplementation((intent) => {
      order.push(`render:${intent.id}`);
      if (intent.id === "1") return new Promise((r) => { resolveFirst = r; });
      return Promise.resolve();
    });
    mockRenderer.stopCurrentOutput = vi.fn().mockImplementation(() => {
      order.push("stop");
      return new Promise((r) => { resolveStop = r; });
    });

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "ambient", priority: 10, salience: "low",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
    };
    const intent2: OutputIntent = {
      id: "2", cursorId: "test", lane: "emergency", priority: 100, salience: "critical",
      text: "Emergency", ttlMs: 5000, interrupt: "hard", output: { caption: true },
    };

    const p1 = arbiter.propose(intent1);
    await new Promise(r => setTimeout(r, 0));

    const p2 = arbiter.propose(intent2);
    await new Promise(r => setTimeout(r, 0));
    expect(order).toEqual(["render:1", "stop"]);

    resolveStop!(undefined);
    resolveFirst!(undefined);
    await p1;
    await p2;
    await new Promise(r => setTimeout(r, 0));

    expect(order).toEqual(["render:1", "stop", "render:2"]);
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

  it("should hold speaking state for estimatedDurationMs", async () => {
    mockRenderer.render = vi.fn().mockResolvedValue(undefined);

    const intent: OutputIntent = {
      id: "dur-test", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Hold me", ttlMs: 5000, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 100, // 100ms
    };

    const p = arbiter.propose(intent);
    await new Promise(r => setTimeout(r, 10));
    
    expect(arbiter.snapshot().speaking).toBe(true);
    
    // Wait for > 100ms
    await new Promise(r => setTimeout(r, 150));
    expect(arbiter.snapshot().speaking).toBe(false);
    
    await p;
  });

  it("drops expired queued output without rendering it", async () => {
    let resolveFirst: (v: void) => void;
    mockRenderer.render = vi.fn().mockImplementation((intent) => {
      if (intent.id === "1") return new Promise((r) => { resolveFirst = r; });
      return Promise.resolve();
    });

    const intent1: OutputIntent = {
      id: "1", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 0,
    };
    const expiredQueued: OutputIntent = {
      id: "expired", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Too late", ttlMs: 10, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 0,
    };

    const p1 = arbiter.propose(intent1);
    await new Promise(r => setTimeout(r, 0));
    const queued = await arbiter.propose(expiredQueued);
    expect(queued.status).toBe("queued");

    now += 11;
    resolveFirst!(undefined);
    await p1;
    await new Promise(r => setTimeout(r, 10));

    expect(mockRenderer.render).toHaveBeenCalledTimes(1);
    expect(mockRenderer.render).not.toHaveBeenCalledWith(expect.objectContaining({ id: "expired" }), expect.any(AbortSignal));
  });

  it("publishes stage.output.dropped when queued output expires", async () => {
    const eventBus = new StelleEventBus();
    arbiter = new StageOutputArbiter({
      renderer: mockRenderer,
      now: () => now,
      maxQueueLength: 5,
      eventBus,
    });
    let resolveFirst: (v: void) => void;
    mockRenderer.render = vi.fn().mockImplementation((intent) => {
      if (intent.id === "1") return new Promise((r) => { resolveFirst = r; });
      return Promise.resolve();
    });

    const p1 = arbiter.propose({
      id: "1", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "First", ttlMs: 5000, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 0,
    });
    await new Promise(r => setTimeout(r, 0));

    await arbiter.propose({
      id: "expired-visible", cursorId: "test", lane: "live_chat", priority: 50, salience: "medium",
      text: "Too late", ttlMs: 10, interrupt: "none", output: { caption: true },
      estimatedDurationMs: 0,
    });

    now += 11;
    resolveFirst!(undefined);
    await p1;
    await new Promise(r => setTimeout(r, 10));

    const dropped = eventBus.getHistory().find(event => event.type === "stage.output.dropped" && event.payload.intent.id === "expired-visible");
    expect(dropped?.payload.reason).toBe("expired");
    expect(mockRenderer.render).not.toHaveBeenCalledWith(expect.objectContaining({ id: "expired-visible" }), expect.any(AbortSignal));
  });

  it("drops debug lane output when debug is disabled", async () => {
    const decision = await arbiter.propose({
      id: "debug-off",
      cursorId: "debug",
      lane: "debug",
      priority: 1,
      salience: "low",
      text: "hidden",
      ttlMs: 5000,
      interrupt: "none",
      output: { caption: true },
    });

    expect(decision.status).toBe("dropped");
    expect(decision.reason).toBe("debug_disabled");
    expect(mockRenderer.render).not.toHaveBeenCalled();
  });

  it("pauses automatic live replies but allows system direct output", async () => {
    arbiter.setAutoReplyPaused(true);

    const liveDecision = await arbiter.propose({
      id: "live-auto",
      cursorId: "live_danmaku",
      lane: "direct_response",
      priority: 60,
      salience: "medium",
      text: "auto",
      ttlMs: 5000,
      interrupt: "none",
      output: { caption: true },
    });
    const systemDecision = await arbiter.propose({
      id: "system-direct",
      cursorId: "system",
      lane: "direct_response",
      priority: 80,
      salience: "high",
      text: "manual",
      ttlMs: 5000,
      interrupt: "none",
      output: { caption: true },
    });

    expect(liveDecision.status).toBe("dropped");
    expect(liveDecision.reason).toBe("auto_reply_paused");
    expect(systemDecision.status).toBe("accepted");
  });

  it("mutes TTS on accepted intents", async () => {
    arbiter.setTtsMuted(true);

    await arbiter.propose({
      id: "tts-muted",
      cursorId: "system",
      lane: "direct_response",
      priority: 80,
      salience: "high",
      text: "manual",
      ttlMs: 5000,
      interrupt: "none",
      output: { caption: true, tts: true },
    });

    expect(mockRenderer.render).toHaveBeenCalledWith(expect.objectContaining({ output: expect.objectContaining({ tts: false }) }), expect.any(AbortSignal));
  });
});
