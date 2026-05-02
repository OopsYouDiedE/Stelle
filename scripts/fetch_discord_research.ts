import "dotenv/config";
import { DiscordRuntime } from "../src/windows/discord/runtime.js";
import fs from "node:fs/promises";
import path from "node:path";

async function run() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN not found in env");

  const channelId = "1235845356697288747";
  const botId = "1498346042675040346";
  const startDate = new Date("2026-04-15T00:00:00Z").getTime();
  const endDate = new Date("2026-04-28T23:59:59Z").getTime();

  console.log(
    `Starting research fetch for channel ${channelId} from ${new Date(startDate).toISOString()} to ${new Date(endDate).toISOString()}`,
  );

  const runtime = new DiscordRuntime();
  await runtime.login(token);

  const allMessages = [];
  let beforeId: string | undefined = undefined;
  let finished = false;
  let batchCount = 0;

  try {
    while (!finished) {
      // Internal fetcher uses limit max 100
      const messages = await runtime.getChannelHistory({
        channelId,
        limit: 100,
        before: beforeId ? undefined : undefined, // We need to use the raw client for better pagination if getChannelHistory doesn't expose beforeId
      });

      // Since the existing tool doesn't expose 'before' in its input but the class supports it,
      // I'll directly use the client for pagination.
      const discordClient = (runtime as any).client;
      const channel = await discordClient.channels.fetch(channelId);
      const fetched = await channel.messages.fetch({ limit: 100, before: beforeId });

      if (fetched.size === 0) {
        finished = true;
        break;
      }

      for (const msg of fetched.values()) {
        const ts = msg.createdTimestamp;
        if (ts < startDate) {
          finished = true;
          break;
        }
        if (ts <= endDate) {
          allMessages.push({
            id: msg.id,
            authorId: msg.author.id,
            authorName: msg.author.username,
            content: msg.content,
            timestamp: ts,
            timeStr: new Date(ts).toISOString(),
          });
        }
        beforeId = msg.id;
      }

      batchCount += fetched.size;
      console.log(`Fetched ${allMessages.length} relevant messages (Total checked: ${batchCount})...`);

      if (batchCount % 500 === 0) {
        console.log("Cooldown: Waiting 1 second...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (fetched.size < 100) {
        finished = true;
      }
    }

    const outputPath = path.resolve("artifacts/research_messages.json");
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(allMessages, null, 2));

    console.log(`Success! Saved ${allMessages.length} messages to ${outputPath}`);
  } catch (err) {
    console.error("Fetch failed:", err);
  } finally {
    await runtime.destroy();
  }
}

run();
