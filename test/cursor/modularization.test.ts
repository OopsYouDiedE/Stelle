import { describe, expect, it, vi } from "vitest";
import { DeviceActionArbiter } from "../../src/device/action_arbiter.js";
import { MockDeviceActionDriver } from "../../src/device/drivers/mock_driver.js";
import { DiscordTextChannelCursor } from "../../src/cursor/discord_cursor.js";
import { LiveDanmakuCursor } from "../../src/cursor/live_cursor.js";
import { BrowserCursor } from "../../src/cursor/modules/browser/cursor.js";
import { cursorModules } from "../../src/cursor/registry.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

function makeContext(overrides: Record<string, unknown> = {}) {
  const eventBus = new StelleEventBus();
  return {
    now: () => 1000,
    config: {
      discord: { ambientEnabled: true, cooldownSeconds: 0, maxReplyChars: 900 },
      live: { ttsEnabled: false, speechQueueLimit: 5 },
      models: { apiKey: "" },
    },
    llm: {},
    tools: { execute: vi.fn() },
    stageOutput: { propose: vi.fn(), cancelByCursor: vi.fn(), snapshot: vi.fn() },
    eventBus,
    ...overrides,
  } as any;
}

function makeDiscordMessage() {
  return {
    id: "m1",
    channelId: "c1",
    guildId: "g1",
    author: { id: "u1", username: "user", displayName: "User" },
    content: "hello",
    cleanContent: "hello",
    createdTimestamp: 1000,
    isMentioned: true,
  };
}

describe("cursor modularization", () => {
  it("registry exposes mode-aware cursor modules", () => {
    const runtimeIds = cursorModules.filter(m => m.enabledInModes.includes("runtime")).map(m => m.id);
    const discordIds = cursorModules.filter(m => m.enabledInModes.includes("discord")).map(m => m.id);

    expect(runtimeIds).toEqual(expect.arrayContaining(["inner", "discord_text_channel", "live_danmaku", "browser"]));
    expect(discordIds).toEqual(expect.arrayContaining(["inner", "discord_text_channel"]));
    expect(discordIds).not.toContain("live_danmaku");
  });

  it("bridges legacy and new discord message events to the text channel cursor", async () => {
    const context = makeContext();
    const cursor = new DiscordTextChannelCursor(context);
    const receiveSpy = vi.spyOn(cursor, "receiveMessage").mockResolvedValue({ observed: true, reason: "mocked" });

    await cursor.initialize();
    context.eventBus.publish({ type: "discord.message.received", source: "discord", payload: { message: makeDiscordMessage() } });
    context.eventBus.publish({ type: "discord.text.message.received", source: "discord", payload: { message: makeDiscordMessage() } });

    expect(receiveSpy).toHaveBeenCalledTimes(2);
    await cursor.stop();
  });

  it("bridges legacy and new live events to the danmaku cursor", async () => {
    const context = makeContext();
    const cursor = new LiveDanmakuCursor(context);
    const receiveSpy = vi.spyOn(cursor, "receiveLiveEvent").mockResolvedValue({ accepted: true, reason: "mocked" } as any);

    await cursor.initialize();
    context.eventBus.publish({ type: "live.event.received", source: "system", payload: { text: "old" } });
    context.eventBus.publish({ type: "live.danmaku.received", source: "system", payload: { text: "new" } });

    expect(receiveSpy).toHaveBeenCalledTimes(2);
    await cursor.stop();
  });

  it("rejects high-risk device actions by default", async () => {
    const arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      eventBus: new StelleEventBus(),
      now: () => 1000,
    });

    const decision = await arbiter.propose({
      id: "a1",
      cursorId: "browser",
      resourceId: "default",
      resourceKind: "browser",
      actionKind: "navigate",
      risk: "external_commit",
      priority: 50,
      ttlMs: 1000,
      reason: "test",
      payload: { url: "https://example.com" },
    });

    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("High-risk");
  });

  it("browser cursor cannot execute without DeviceActionArbiter", async () => {
    const cursor = new BrowserCursor(makeContext({ deviceAction: undefined }));
    const result = await cursor.receiveObservation({
      resourceId: "default",
      requestedAction: {
        actionKind: "click",
        risk: "safe_interaction",
        payload: { selector: "#ok" },
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("DeviceActionArbiter");
  });
});
