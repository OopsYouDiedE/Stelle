import fs from "node:fs/promises";
import path from "node:path";

async function analyze() {
  const data = JSON.parse(await fs.readFile("reference/legacy-src/artifacts/research_messages.json", "utf8"));
  const botId = "1484173471100436685";

  const stelleMessages = data.filter((m) => m.authorId === botId).sort((a, b) => a.timestamp - b.timestamp);
  const otherMessages = data.filter((m) => m.authorId !== botId);

  console.log("--- Character Evolution ---");
  console.log("First 15 messages (Arrival):");
  stelleMessages.slice(0, 15).forEach((m) => console.log(`[${m.timeStr}] ${m.content}`));

  console.log("\nLast 15 messages (Recent):");
  stelleMessages.slice(-15).forEach((m) => console.log(`[${m.timeStr}] ${m.content}`));

  console.log("\n--- Social Impact ---");
  // Search for mentions of Stelle by ID or name
  const mentions = otherMessages.filter((m) => m.content.includes(botId) || m.content.toLowerCase().includes("stelle"));
  console.log(`Total mentions of Stelle: ${mentions.length}`);

  // High salience users
  const userCounts = {};
  otherMessages.forEach((m) => {
    // Count interactions (either mentioning Stelle or just being active in the same context)
    // For now, let's stick to mentions for impact analysis
    if (m.content.includes(botId) || m.content.toLowerCase().includes("stelle")) {
      userCounts[m.authorName] = (userCounts[m.authorName] || 0) + 1;
    }
  });
  console.log(
    "Users talking to/about Stelle most:",
    Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  );

  // Sample feedback
  console.log("\nSample Feedback/Impressions (Middle to End):");
  mentions
    .slice(Math.floor(mentions.length / 2), Math.floor(mentions.length / 2) + 30)
    .forEach((m) => console.log(`[${m.authorName}]: ${m.content}`));
}

analyze();
