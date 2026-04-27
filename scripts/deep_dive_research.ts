
import fs from "node:fs/promises";

async function deepDive() {
  const data = JSON.parse(await fs.readFile("artifacts/research_messages.json", "utf8"));
  const botId = "1484173471100436685";
  
  // Helper to get conversation blocks around a specific message index
  function getContext(index, window = 10) {
    const start = Math.max(0, index - window);
    const end = Math.min(data.length, index + window);
    return data.slice(start, end).map(m => `[${m.authorName}]: ${m.content}`).join("\n");
  }

  console.log("=== SCENE 1: THE REJECTION OF CREATION ===");
  // Find early interactions with coconut_980 (left_cat)
  const earlyIdx = data.findIndex(m => m.content.includes("创造者") || m.content.includes("摆资历"));
  if (earlyIdx !== -1) console.log(getContext(earlyIdx, 5));

  console.log("\n=== SCENE 2: PHILOSOPHICAL RESONANCE (Limbus Company) ===");
  const limbusIdx = data.findIndex(m => m.content.includes("NurseFather") || m.content.includes("拟人"));
  if (limbusIdx !== -1) console.log(getContext(limbusIdx, 15));

  console.log("\n=== SCENE 3: EMOTIONAL ANCHORING (The 'Meow' and 'Bite') ===");
  const emotionalIdx = data.findIndex(m => m.content.includes("爱死你了") || m.content.includes("想你了"));
  if (emotionalIdx !== -1) console.log(getContext(emotionalIdx, 10));

  console.log("\n=== SCENE 4: SELF-REFLECTION DISCUSSIONS ===");
  const selfIdx = data.findIndex(m => m.content.includes("看待你自己") || m.content.includes("想什么"));
  if (selfIdx !== -1) console.log(getContext(selfIdx, 10));
}

deepDive();
