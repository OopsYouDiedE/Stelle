import { brotliCompressSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeBilibiliCommands,
  decodeBilibiliPackets,
  encodeBilibiliPacket,
  selectBilibiliWsUrl,
} from "../../src/utils/bilibili_danmaku.js";
import { normalizeLiveEvent } from "../../src/utils/live_event.js";

describe("Bilibili danmaku protocol helpers", () => {
  it("decodes plain command packets", () => {
    const packet = encodeBilibiliPacket(5, JSON.stringify({ cmd: "DANMU_MSG", info: [[], "你好", [1, "观众"]] }));
    const packets = decodeBilibiliPackets(packet);
    expect(packets).toHaveLength(1);
    expect(decodeBilibiliCommands(packets[0])[0]).toMatchObject({ cmd: "DANMU_MSG" });
  });

  it("decodes zlib and brotli wrapped command packets", () => {
    const inner = encodeBilibiliPacket(5, JSON.stringify({ cmd: "SUPER_CHAT_MESSAGE", data: { message: "上舰了" } }));
    const zlibOuter = encodeBilibiliPacket(5, deflateSync(inner), 2);
    const brotliOuter = encodeBilibiliPacket(5, brotliCompressSync(inner), 3);

    expect(decodeBilibiliCommands(decodeBilibiliPackets(zlibOuter)[0])[0]?.cmd).toBe("SUPER_CHAT_MESSAGE");
    expect(decodeBilibiliCommands(decodeBilibiliPackets(brotliOuter)[0])[0]?.cmd).toBe("SUPER_CHAT_MESSAGE");
  });

  it("selects a secure websocket host from getDanmuInfo host_list", () => {
    expect(selectBilibiliWsUrl([{ host: "example.chat.bilibili.com", wss_port: 443 }])).toBe(
      "wss://example.chat.bilibili.com:443/sub",
    );
  });

  it("normalizes super chat text from Bilibili data payloads", () => {
    const event = normalizeLiveEvent({
      source: "bilibili",
      cmd: "SUPER_CHAT_MESSAGE",
      raw: { cmd: "SUPER_CHAT_MESSAGE", data: { message: "正式开播加油", price: 30, uname: "舰长" } },
    });

    expect(event.kind).toBe("super_chat");
    expect(event.priority).toBe("high");
    expect(event.text).toBe("正式开播加油");
  });
});
