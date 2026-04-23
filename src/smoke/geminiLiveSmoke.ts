import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Client, GatewayIntentBits, Partials, type TextBasedChannel } from "discord.js";
import { GeminiTextProvider } from "../gemini/GeminiTextProvider.js";
import { KokoroTtsProvider } from "../tts/KokoroTtsProvider.js";
import { createSearchTools } from "../tools/search.js";
import { MemoryAuditSink, ToolRegistry } from "../tools/ToolRegistry.js";
import { LiveRuntime } from "../live/LiveRuntime.js";

const OUTPUT_DIR = path.resolve("test");
const CHANNEL_ID = process.env.SMOKE_DISCORD_CHANNEL_ID ?? "1494546366808985710";

interface SavedOutput {
  path: string;
  summary: string;
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  const text = new GeminiTextProvider();
  const tts = new KokoroTtsProvider({ outputDir: OUTPUT_DIR });
  const outputs: SavedOutput[] = [];

  outputs.push(await todayNews(text, dateLabel));
  outputs.push(await discordTwoDaysAgoSummary(text, CHANNEL_ID));
  outputs.push(...(await routeNewsToLiveAndTts(text, tts, dateLabel)));

  await writeJson("smoke-report.json", {
    generatedAt: new Date().toISOString(),
    channelId: CHANNEL_ID,
    outputs,
  });
}

async function todayNews(text: GeminiTextProvider, dateLabel: string): Promise<SavedOutput> {
  const search = await searchWeb(`今天 新闻 ${dateLabel}`, 8);
  await writeJson("today-news-search.json", search);
  const prompt = [
    `今天是 ${dateLabel}。`,
    "请基于下面的搜索结果，总结今天值得关注的新闻。要求：",
    "1. 用中文。",
    "2. 分成 5-8 条要点。",
    "3. 每条包含新闻主题、为什么重要、来源标题。",
    "4. 不要编造搜索结果之外的信息。",
    "",
    JSON.stringify(search, null, 2),
  ].join("\n");
  const summary = await text.generateText(prompt, { role: "primary", temperature: 0.4 });
  const file = await writeText("today-news-summary.md", summary);
  return { path: file, summary: "Primary Gemini model summarized today's news." };
}

async function discordTwoDaysAgoSummary(text: GeminiTextProvider, channelId: string): Promise<SavedOutput> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("Missing DISCORD_TOKEN for Discord smoke test.");
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
  });
  await client.login(token);
  try {
    const { start, end } = twoDaysAgoWindow();
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) {
      throw new Error(`Channel ${channelId} is not a fetchable text channel.`);
    }
    const messages = await fetchMessagesInWindow(channel, start.getTime(), end.getTime());
    await writeJson("discord-two-days-ago-messages.json", {
      channelId,
      start: start.toISOString(),
      end: end.toISOString(),
      count: messages.length,
      messages,
    });
    const prompt = [
      `请总结 Discord 频道 ${channelId} 在北京时间 ${start.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 到 ${end.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 的消息。`,
      "要求：",
      "1. 使用中文。",
      "2. 按话题归纳，不要逐条流水账。",
      "3. 标出需要后续行动的事项。",
      "4. 如果消息很少或为空，也要明确说明。",
      "",
      JSON.stringify(messages, null, 2),
    ].join("\n");
    const summary = await text.generateText(prompt, { role: "secondary", temperature: 0.3 });
    const file = await writeText("discord-two-days-ago-summary.md", summary);
    return { path: file, summary: "Secondary Gemini model summarized the target Discord channel." };
  } finally {
    await client.destroy();
  }
}

async function routeNewsToLiveAndTts(text: GeminiTextProvider, tts: KokoroTtsProvider, dateLabel: string): Promise<SavedOutput[]> {
  const live = new LiveRuntime();
  await live.start();
  const search = await searchWeb(`today breaking news ${dateLabel}`, 5);
  await writeJson("route-news-search.json", search);
  const prompt = [
    `今天是 ${dateLabel}。`,
    "你是直播口播路线，基于搜索结果输出一段 45 秒以内的中文新闻简报。",
    "要求适合直接显示字幕和 TTS 朗读。不要添加来源之外的事实。",
    "",
    JSON.stringify(search, null, 2),
  ].join("\n");
  const chunks: string[] = [];
  let caption = "";
  for await (const chunk of text.generateTextStream(prompt, { role: "primary", temperature: 0.5 })) {
    chunks.push(chunk);
    caption += chunk;
    await live.setCaption(caption);
  }
  const streamFile = await writeText("route-news-stream.txt", chunks.join(""));
  const chunksFile = await writeJson("route-news-stream-chunks.json", { chunks });
  const ttsDir = path.join(OUTPUT_DIR, "route-news-tts");
  await fs.rm(ttsDir, { recursive: true, force: true });
  const artifacts = await tts.synthesizeTextStream(singleChunk(chunks.join("")), {
    outputDir: ttsDir,
    filePrefix: "route-news",
  });
  const ttsFile = await writeJson("route-news-tts-artifacts.json", { artifacts });
  return [
    { path: streamFile, summary: "Primary Gemini model streamed route news output." },
    { path: chunksFile, summary: "Saved streamed text chunks." },
    { path: ttsFile, summary: "Kokoro TTS generated route audio artifacts." },
  ];
}

async function searchWeb(query: string, count: number) {
  const registry = new ToolRegistry();
  for (const tool of createSearchTools()) registry.register(tool);
  const result = await registry.execute("search.web_search", { query, count }, {
    caller: "stelle",
    authority: { caller: "stelle", allowedAuthorityClasses: ["stelle"] },
    audit: new MemoryAuditSink(),
  });
  if (!result.ok) throw new Error(result.summary);
  return result.data;
}

async function fetchMessagesInWindow(channel: TextBasedChannel & { messages: { fetch(options: { limit: number; before?: string }): Promise<Map<string, { id: string; createdTimestamp: number; author: { id: string; username: string; bot: boolean }; cleanContent: string; content: string }>> } }, start: number, end: number) {
  const collected: unknown[] = [];
  let before: string | undefined;
  for (let page = 0; page < 20; page++) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    const values = [...batch.values()];
    for (const message of values) {
      if (message.createdTimestamp >= start && message.createdTimestamp < end) {
        collected.push({
          id: message.id,
          createdAt: new Date(message.createdTimestamp).toISOString(),
          author: {
            id: message.author.id,
            username: message.author.username,
            bot: message.author.bot,
          },
          content: message.cleanContent || message.content,
        });
      }
    }
    const oldest = values.at(-1);
    if (!oldest || oldest.createdTimestamp < start) break;
    before = oldest.id;
  }
  return collected;
}

function twoDaysAgoWindow(): { start: Date; end: Date } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const shanghaiMidnightUtc = Date.UTC(year, month - 1, day, -8, 0, 0, 0);
  const start = new Date(shanghaiMidnightUtc - 2 * 24 * 60 * 60 * 1000);
  const end = new Date(shanghaiMidnightUtc - 1 * 24 * 60 * 60 * 1000);
  return { start, end };
}

async function* singleChunk(text: string): AsyncIterable<string> {
  yield text;
}

async function writeText(name: string, content: string): Promise<string> {
  const file = path.join(OUTPUT_DIR, name);
  await fs.writeFile(file, content, "utf8");
  return file;
}

async function writeJson(name: string, content: unknown): Promise<string> {
  const file = path.join(OUTPUT_DIR, name);
  await fs.writeFile(file, JSON.stringify(content, null, 2), "utf8");
  return file;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
