/**
 * 模块：StelleCore 主动内驱循环
 *
 * 运行逻辑：
 * - runtime 模式下按固定间隔触发反思。
 * - 读取当前关注方向和最近研究日志，调用 LLM 生成新的关注方向。
 * - 把关注方向写回长期记忆，并追加一条研究日志。
 *
 * 主要方法：
 * - `start()` / `stop()`：定时循环生命周期。
 * - `trigger()`：手动或定时触发一次反思。
 * - `snapshot()`：给 debug/runtime state 展示 Core 状态。
 */
import type { LlmClient } from "./llm.js";
import type { MemoryStore } from "./memory.js";
import { truncateText } from "./text.js";

export interface StelleCoreOptions {
  llm: LlmClient;
  memory: MemoryStore;
  intervalHours: number;
}

export interface CoreRunResult {
  ok: boolean;
  reason: string;
  focusUpdated: boolean;
  researchLogId?: string;
  error?: string;
}

export interface StelleCoreSnapshot {
  running: boolean;
  lastReflectionAt?: number;
  currentFocusSummary?: string;
  lastError?: string;
}

export class StelleCore {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private lastReflectionAt?: number;
  private currentFocusSummary?: string;
  private lastError?: string;

  constructor(private readonly options: StelleCoreOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const intervalMs = Math.max(1, this.options.intervalHours) * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      void this.trigger("scheduled reflection");
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
  }

  async trigger(reason: string): Promise<CoreRunResult> {
    try {
      const previousFocus = await this.options.memory.readLongTerm("current_focus");
      const recentLogs = await this.options.memory.readResearchLogs(6);
      const focus = await this.reflect(reason, previousFocus, recentLogs);
      await this.options.memory.writeLongTerm("current_focus", focus);
      const researchLogId = await this.options.memory.appendResearchLog({
        focus,
        process: [`Reflection trigger: ${reason}`, `Previous focus: ${truncateText(previousFocus ?? "(none)", 240)}`],
        conclusion: focus,
      });
      this.lastReflectionAt = Date.now();
      this.currentFocusSummary = truncateText(focus, 240);
      this.lastError = undefined;
      return { ok: true, reason, focusUpdated: true, researchLogId };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, reason, focusUpdated: false, error: this.lastError };
    }
  }

  snapshot(): StelleCoreSnapshot {
    return {
      running: this.running,
      lastReflectionAt: this.lastReflectionAt,
      currentFocusSummary: this.currentFocusSummary,
      lastError: this.lastError,
    };
  }

  private async reflect(reason: string, previousFocus: string | null, recentLogs: string[]): Promise<string> {
    if (!this.options.llm.config.apiKey) {
      return previousFocus?.trim() || "保持轻量观察：先关注最近对话里反复出现的关系、情绪和未完成问题。";
    }

    const prompt = [
      "You are StelleCore, the private reflective loop for Stelle.",
      "Write one concise current focus for future cursor prompts. Plain text only.",
      `Trigger: ${reason}`,
      `Previous focus:\n${previousFocus ?? "(none)"}`,
      `Recent research logs:\n${recentLogs.join("\n\n") || "(none)"}`,
    ].join("\n\n");

    return truncateText(await this.options.llm.generateText(prompt, { role: "secondary", temperature: 0.5, maxOutputTokens: 240 }), 1200);
  }
}
