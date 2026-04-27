
import fs from "node:fs/promises";

async function socialAtlas() {
  const data = JSON.parse(await fs.readFile("artifacts/research_messages.json", "utf8"));
  const botId = "1484173471100436685";
  
  // 1. Identify active users (excluding bot and coconut_980)
  const users = {};
  data.forEach(m => {
    if (m.authorId !== botId && m.authorId !== "1240584393458712607") {
      if (!users[m.authorId]) {
        users[m.authorId] = { name: m.authorName, messages: [], mentionsBot: 0, botReplies: 0 };
      }
      users[m.authorId].messages.push(m.content);
      if (m.content.includes(botId) || m.content.toLowerCase().includes("stelle")) {
        users[m.authorId].mentionsBot++;
      }
    }
  });

  // 2. Identify who Stelle replied to
  data.forEach((m, idx) => {
    if (m.authorId === botId && m.content.includes("[回复")) {
      // Find the message being replied to
      const context = data.slice(Math.max(0, idx - 5), idx);
      context.reverse().forEach(prev => {
        if (users[prev.authorId]) {
          users[prev.authorId].botReplies++;
        }
      });
    }
  });

  const sortedUsers = Object.values(users).sort((a, b) => b.messages.length - a.messages.length).slice(0, 10);

  console.log("=== SOCIAL ATLAS: KEY PERSONAS ===");
  for (const user of sortedUsers) {
    console.log(`\nUser: ${user.name} (Msgs: ${user.messages.length}, Bot-Interactions: ${user.mentionsBot + user.botReplies})`);
    
    // Sample their non-bot interests
    const samples = user.messages.slice(0, 15);
    console.log("Topics/Interests Sample:");
    samples.forEach(s => console.log(` - ${s.substring(0, 100)}`));
    
    // Sample their bot-related interactions
    const botInteractions = data.filter(m => 
      (m.authorId === Object.keys(users).find(id => users[id].name === user.name)) && 
      (m.content.includes(botId) || m.content.toLowerCase().includes("stelle"))
    ).slice(0, 5);
    
    if (botInteractions.length > 0) {
      console.log("Direct Interactions with Stelle:");
      botInteractions.forEach(bi => console.log(` > ${bi.content}`));
    }
  }
}

socialAtlas();
