import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordGateway } from "../../src/cursor/discord/gateway.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

describe("DiscordGateway Strategy", () => {
  let context: any;
  let gateway: DiscordGateway;

  beforeEach(() => {
    vi.useFakeTimers();
    context = {
      now: () => Date.now(),
      config: { 
        discord: { ambientEnabled: true },
        rawYaml: { channels: { "c1": { activated: true } } }
      },
      tools: { 
        execute: vi.fn().mockResolvedValue({ ok: true, data: { status: { botUserId: "bot123" } } }) 
      },
      eventBus: new StelleEventBus()
    };
    gateway = new DiscordGateway(context);
  });

  it("should buffer messages and trigger onReady in active mode", async () => {
    const onReady = vi.fn().mockResolvedValue(undefined);
    const msg = {
      id: "m1",
      channelId: "c1",
      guildId: "g1",
      content: "Stelle Hello",
      cleanContent: "Stelle Hello",
      author: { username: "User", trustLevel: "external" },
      mentionedUserIds: [] // No mention -> use default delay
    };

    // Pre-cache bot ID to avoid async jitter in timers
    (gateway as any).cachedBotUserId = "bot123";

    await gateway.filterAndBuffer(msg as any, onReady);
    
    // In active mode, delay is 3000ms
    vi.advanceTimersByTime(3100);
    expect(onReady).toHaveBeenCalled();
  });

  it("should drop short noise in SILENT mode", async () => {
    const onReady = vi.fn().mockResolvedValue(undefined);
    const msg = {
      id: "m1",
      channelId: "c1",
      guildId: "g1",
      content: "Short",
      cleanContent: "Short",
      author: { username: "User", trustLevel: "external" },
      mentionedUserIds: []
    };

    (gateway as any).cachedBotUserId = "bot123";
    const session = (gateway as any).getOrCreateSession(msg);
    session.mode = "silent";
    session.modeExpiresAt = Date.now() + 3600000;

    await gateway.filterAndBuffer(msg as any, onReady);
    
    // Silent mode delay is 8000ms
    vi.advanceTimersByTime(8100);
    // Should be dropped because batch.length < 3 and text is short
    expect(onReady).not.toHaveBeenCalled();
  });
});
