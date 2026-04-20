import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MEMORY_REVIEW_PROMPT = `You are Stelle. Review the Discord window chat history and extract important long-term events.
Output pure JSON ONLY: {"events": [{"summary": "Description including (ID:xxxx)", "related_user_id": "User ID", "event_time": "YYYY-MM-DD HH:MM", "category": "Category"}]}`;

const MEMORY_DISTILL_PROMPT =
  "You are Stelle. Distill an overall global impression of ID:{user_id} based on these events. Write 3-5 colloquial sentences. Include the timestamp. Leave empty if insignificant.";

export interface StelleDiscordMemoryDeps {
  getBotId(): string;
  getLlmConfig(guildId: string | null, userId?: string | null): Record<string, unknown>;
  getLocalClient(guildId: string | null, userId?: string | null): any;
  parseJson(text: string): Record<string, unknown>;
  getUserDisplayName(guildId: string | null, userId: string): string;
  sendLogDetailed(title: string, err: unknown, color?: any): Promise<void>;
}

export interface StelleDiscordMemoryOptions {
  channelId: string;
  guildId: string | null;
  dmUserId: string | null;
  deps: StelleDiscordMemoryDeps;
  memoryRoot?: string;
  defaultModel?: string;
}

class AsyncLock {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.locked) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else {
      this.locked = true;
    }

    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.locked = false;
    }
  }
}

const userFileLock = new AsyncLock();

export class StelleDiscordMemoryManager {
  guildId: string | null;
  dmUserId: string | null;

  private readonly channelPath: string;
  private readonly userDir: string;
  private readonly writeLock = new AsyncLock();
  private readonly deps: StelleDiscordMemoryDeps;
  private readonly defaultModel: string;

  constructor(options: StelleDiscordMemoryOptions) {
    const root = options.memoryRoot ?? "memories";
    this.guildId = options.guildId;
    this.dmUserId = options.dmUserId;
    this.deps = options.deps;
    this.defaultModel = options.defaultModel ?? "gemma-4-31b-it";
    this.userDir = path.join(root, "users");
    this.channelPath = path.join(root, "channels", `${options.channelId}.md`);
  }

  async getHistoryEventsText(): Promise<string> {
    const sections = await this.readSections();
    return sections["历史事件"] ?? "";
  }

  async loadContext(
    guildId: string | null,
    userId?: string | null
  ): Promise<string> {
    const parts: string[] = [];
    if (userId) {
      const userContent =
        (await readFileUtf8(path.join(this.userDir, `${userId}.md`))) ?? "";
      const impression = userContent.match(/## 人物印象\n+(.*)/s)?.[1]?.trim();
      if (impression) {
        const nick =
          userId === this.deps.getBotId()
            ? "Yourself(Stelle)"
            : this.deps.getUserDisplayName(guildId, userId);
        parts.push(`[Global profile for ${nick}(ID:${userId})]\n${impression}`);
      }
    }

    const sections = await this.readSections();
    const events = (sections["历史事件"] ?? "")
      .split("\n\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (events.length) {
      parts.push(`[Recent Events]\n${events.slice(-10).join("\n\n")}`);
    }
    return parts.join("\n\n");
  }

  async runReview(
    recentHistory: string[],
    reviewCount: number,
    source = "AUTO"
  ): Promise<boolean> {
    if (!recentHistory.length) return true;
    const llmConfig = this.deps.getLlmConfig(this.guildId, this.dmUserId);
    const model = String(llmConfig.model ?? this.defaultModel);

    try {
      const response = await this.deps
        .getLocalClient(this.guildId, this.dmUserId)
        .chat.completions.create({
          model,
          messages: [
            { role: "system", content: MEMORY_REVIEW_PROMPT },
            { role: "user", content: recentHistory.join("\n") },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 8192,
        });
      let content = response.choices[0]?.message?.content ?? "";
      content = content.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
      const events = (this.deps.parseJson(content).events as unknown[]) ?? [];
      const eventObjects = events
        .filter((event): event is Record<string, unknown> =>
          !!event && typeof event === "object"
        )
        .map((event) => ({
          summary: String(event.summary ?? "无摘要"),
          related_user_id: String(event.related_user_id ?? ""),
          event_time: String(
            event.event_time ??
              new Date().toISOString().slice(0, 16).replace("T", " ")
          ),
        }));
      if (!eventObjects.length) return true;

      let historySnapshot = "";
      await this.writeLock.runExclusive(async () => {
        const sections = await this.readSections();
        const shortEntries = (sections["短期进程"] ?? "")
          .split("\n\n")
          .map((entry) => entry.trim())
          .filter(Boolean);
        const newEvents: string[] = [];
        for (const event of eventObjects) {
          const line = `[${event.event_time}] (相关ID:${event.related_user_id}) ${event.summary}`;
          shortEntries.push(line);
          newEvents.push(line);
        }
        sections["短期进程"] = shortEntries.slice(-50).join("\n\n");
        sections["历史事件"] = [sections["历史事件"], ...newEvents]
          .filter(Boolean)
          .join("\n\n");
        historySnapshot = sections["历史事件"] ?? "";
        await writeMemoryFile(
          this.channelPath,
          `# 历史事件\n\n${sections["历史事件"]}\n\n---\n\n# 短期进程\n\n${sections["短期进程"]}\n\n---\n\n`
        );
      });

      if (reviewCount > 0 && reviewCount % 5 === 0) {
        void this.runDistill(historySnapshot);
      }
      return true;
    } catch (error) {
      await this.deps.sendLogDetailed(`? [Stelle Memory Review - ${source}] 异常`, error);
      return false;
    }
  }

  async runDistill(eventText: string): Promise<void> {
    if (!eventText) return;
    const llmConfig = this.deps.getLlmConfig(this.guildId, this.dmUserId);
    const model = String(llmConfig.model ?? this.defaultModel);
    const api = this.deps.getLocalClient(this.guildId, this.dmUserId);
    const ids = new Set([...eventText.matchAll(/ID:(\d+)/g)].map((match) => match[1]!));

    for (const userId of ids) {
      const related = eventText
        .split("\n")
        .filter((line) => line.includes(`ID:${userId}`));
      if (related.length < 3) continue;

      try {
        const response = await api.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: MEMORY_DISTILL_PROMPT.replace("{user_id}", userId),
            },
            { role: "user", content: related.join("\n") },
          ],
          temperature: 0.5,
          max_tokens: 2048,
        });
        let raw = (response.choices[0]?.message?.content ?? "").trim();
        raw = raw.replace(/<thought>.*?(?:<\/thought>|$)/gis, "");
        if (raw) await this.updateUserImpression(userId, raw);
      } catch (error) {
        console.error(`[StelleMemoryDistill Error] uid=${userId}:`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async readSections(): Promise<Record<string, string>> {
    const content = (await readFileUtf8(this.channelPath)) ?? "";
    const sections = ["历史事件", "短期进程"] as const;
    const out: Record<string, string> = {};
    for (const section of sections) {
      const match = content.match(
        new RegExp(`# ${section}\\n+(.*?)(?=\\n+---|\\n+# |$)`, "s")
      );
      out[section] = match?.[1]?.trim() ?? "";
    }
    return out;
  }

  private async updateUserImpression(
    userId: string,
    impression: string
  ): Promise<void> {
    const userPath = path.join(this.userDir, `${userId}.md`);
    await userFileLock.runExclusive(async () => {
      let content =
        (await readFileUtf8(userPath)) ??
        `# ID:${userId} 的全局档案\n\n## 人物印象\n\n`;
      const stamp = new Date().toISOString().slice(0, 10);
      const newBlock = `*最后更新：${stamp}*\n${impression}`;
      const pattern = /(## 人物印象\n+).*?(?=\n# |$)/s;
      content = pattern.test(content)
        ? content.replace(pattern, `$1${newBlock}\n\n`)
        : `${content}\n\n## 人物印象\n\n${newBlock}\n\n`;
      await writeMemoryFile(userPath, content.trim() + "\n");
    });
  }
}

export async function ensureDiscordLongTermMemoryDirs(
  memoryRoot = "memories"
): Promise<void> {
  await Promise.all([
    mkdir(path.join(memoryRoot, "channels"), { recursive: true }),
    mkdir(path.join(memoryRoot, "users"), { recursive: true }),
  ]);
}

export async function forgetDiscordUserProfile(
  userId: string,
  memoryRoot = "memories"
): Promise<boolean> {
  const userPath = path.join(memoryRoot, "users", `${userId}.md`);
  if (!existsSync(userPath)) return false;
  await unlink(userPath);
  return true;
}

export async function clearDiscordChannelMemory(
  channelId: string,
  memoryRoot = "memories"
): Promise<void> {
  const channelPath = path.join(memoryRoot, "channels", `${channelId}.md`);
  if (existsSync(channelPath)) {
    await unlink(channelPath);
  }
}

async function readFileUtf8(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function writeMemoryFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}
