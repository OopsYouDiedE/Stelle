import { moderateLiveEvent, normalizeLiveEvent, type NormalizedLiveEvent } from "../../utils/live_event.js";
import type { CursorContext } from "../types.js";

/**
 * 模块：Live Gateway (感知与缓冲)
 */
export class LiveGateway {
  private buffer: NormalizedLiveEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly context: CursorContext) {}

  /**
   * 接收原始直播事件并进行初步过滤
   */
  public async receive(payload: Record<string, unknown>, onFlush: (batch: NormalizedLiveEvent[]) => void): Promise<{ accepted: boolean; reason: string }> {
    const event = normalizeLiveEvent(payload);
    const moderation = moderateLiveEvent(event);

    if (!moderation.allowed) {
      this.publishSystemEvent(event.id, "dropped", moderation.reason);
      return { accepted: true, reason: moderation.reason };
    }

    // 基础过滤：噪音识别
    if (/^[0-9+]+$|^扣|^签到/u.test(event.text.trim()) && event.priority !== "high") {
      return { accepted: true, reason: "noise_filtered" };
    }

    this.buffer.push(event);
    this.publishSystemEvent(event.id, "incoming", event.text);

    // 动态防抖：SC/打赏立即触发，普通弹幕等待窗口
    const delay = event.priority === "high" ? 100 : 2000;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const batch = [...this.buffer];
      this.buffer = [];
      onFlush(batch);
    }, delay);

    return { accepted: true, reason: "buffered" };
  }

  private publishSystemEvent(id: string, lane: string, text: string) {
    this.context.tools.execute(
      "live.push_event",
      { event_id: id, lane, text },
      { 
        caller: "cursor", 
        cursorId: "live", 
        cwd: process.cwd(), 
        allowedAuthority: ["external_write"],
        allowedTools: ["live.push_event"] // 必须显式授权
      }
    ).catch(err => {
      // 至少在调试时能看到为什么失败
      if (process.env.DEBUG) console.warn("[LiveGateway] System event push failed:", err.message);
    });
  }

  public getBufferSize(): number {
    return this.buffer.length;
  }

  public clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.buffer = [];
  }
}
