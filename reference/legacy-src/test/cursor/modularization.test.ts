import { describe, expect, it, vi } from "vitest";
import { DeviceActionArbiter } from "../../src/actuator/action_arbiter.js";
import { MockDeviceActionDriver } from "../../src/device/drivers/mock_driver.js";
import { DiscordTextChannelCursor } from "../../src/cursor/discord/cursor.js";
import { LiveDanmakuCursor } from "../../src/cursor/live/cursor.js";
import { BrowserCursor } from "../../src/cursor/modules/browser/cursor.js";
import { DesktopInputCursor } from "../../src/cursor/modules/desktop-input/cursor.js";
import { cursorModules, isCursorEnabledByConfig, selectCursorModules } from "../../src/cursor/registry.js";
import { StelleEventBus } from "../../src/utils/event_bus.js";

function makeContext(overrides: Record<string, unknown> = {}) {
  const eventBus = new StelleEventBus();
  return {
    now: () => 1000,
    config: {
      discord: { ambientEnabled: true, cooldownSeconds: 0, maxReplyChars: 900 },
      live: { ttsEnabled: false, speechQueueLimit: 5 },
      browser: { enabled: false },
      desktopInput: { enabled: false },
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
    const runtimeIds = cursorModules.filter((m) => m.enabledInModes.includes("runtime")).map((m) => m.id);
    const discordIds = cursorModules.filter((m) => m.enabledInModes.includes("discord")).map((m) => m.id);

    expect(runtimeIds).toEqual(
      expect.arrayContaining(["inner", "discord_text_channel", "live_danmaku", "browser", "desktop_input"]),
    );
    expect(discordIds).toEqual(expect.arrayContaining(["inner", "discord_text_channel"]));
    expect(discordIds).not.toContain("live_danmaku");
  });

  it("honors short cursor enabled aliases for canonical cursor modules", () => {
    expect(isCursorEnabledByConfig("discord_text_channel", { cursors: { discord: { enabled: false } } })).toBe(false);
    expect(isCursorEnabledByConfig("live_danmaku", { cursors: { live: { enabled: false } } })).toBe(false);

    const selected = selectCursorModules({
      mode: "runtime",
      liveAvailable: true,
      config: {
        discord: { enabled: false, token: "token", ambientEnabled: true, cooldownSeconds: 0, maxReplyChars: 900 },
        live: { enabled: false, ttsEnabled: false, speechQueueLimit: 5 },
        browser: { enabled: false },
        desktopInput: { enabled: false },
        rawYaml: { cursors: { discord: { enabled: false }, live: { enabled: false } } },
      } as any,
    }).map((module) => module.id);

    expect(selected).not.toContain("discord_text_channel");
    expect(selected).not.toContain("live_danmaku");
  });

  it("bridges legacy and new discord message events to the text channel cursor", async () => {
    const context = makeContext();
    const cursor = new DiscordTextChannelCursor(context);
    const receiveSpy = vi.spyOn(cursor, "receiveMessage").mockResolvedValue({ observed: true, reason: "mocked" });

    await cursor.initialize();
    context.eventBus.publish({
      type: "discord.message.received",
      source: "discord",
      payload: { message: makeDiscordMessage() },
    });
    context.eventBus.publish({
      type: "discord.text.message.received",
      source: "discord",
      payload: { message: makeDiscordMessage() },
    });

    expect(receiveSpy).toHaveBeenCalledTimes(2);
    await cursor.stop();
  });

  it("bridges legacy and typed danmaku live events to the danmaku cursor without duplicates", async () => {
    const context = makeContext();
    const cursor = new LiveDanmakuCursor(context);
    const receiveSpy = vi
      .spyOn(cursor, "receiveLiveEvent")
      .mockResolvedValue({ accepted: true, reason: "mocked" } as any);

    await cursor.initialize();
    context.eventBus.publish({
      type: "live.event.received",
      source: "system",
      payload: { id: "same-live-event", source: "fixture", text: "typed" },
    });
    context.eventBus.publish({
      type: "live.event.danmaku",
      source: "system",
      payload: { id: "new-live-event", source: "fixture", text: "new" },
    });
    context.eventBus.publish({
      type: "live.danmaku.received",
      source: "system",
      payload: { id: "same-live-event", source: "fixture", text: "legacy duplicate" },
    });

    expect(receiveSpy).toHaveBeenCalledTimes(2);
    await cursor.stop();
  });

  it("rejects high-risk device actions by default", async () => {
    const arbiter = new DeviceActionArbiter({
      drivers: [new MockDeviceActionDriver("browser")],
      eventBus: new StelleEventBus(),
      now: () => 1000,
      allowlist: { cursors: ["browser"], resources: ["default"], risks: ["system"] },
    });

    const decision = await arbiter.propose({
      id: "a1",
      cursorId: "browser",
      resourceId: "default",
      resourceKind: "browser",
      actionKind: "navigate",
      risk: "system", // 'system' risk triggers high-risk rejection
      priority: 50,
      createdAt: 1000,
      ttlMs: 5000,
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

  it("desktop input cursor routes keyboard and mouse actions through DeviceActionArbiter", async () => {
    const deviceAction = {
      propose: vi.fn().mockResolvedValue({ status: "completed", reason: "ok" }),
    };
    const cursor = new DesktopInputCursor(makeContext({ deviceAction }));
    const result = await cursor.receiveObservation({
      resourceId: "desktop",
      activeWindow: "Cursor",
      requestedAction: {
        actionKind: "click",
        payload: { x: 100, y: 200 },
      },
    });

    expect(result.accepted).toBe(true);
    expect(deviceAction.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorId: "desktop_input",
        resourceKind: "desktop_input",
        resourceId: "desktop",
        actionKind: "click",
        risk: "safe_interaction",
        payload: { x: 100, y: 200 },
      }),
    );
  });
});
