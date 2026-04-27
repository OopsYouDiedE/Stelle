import fs from "node:fs/promises";
import path from "node:path";

interface ResearchMessage {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  timeStr: string;
}

const inputPath = process.argv[2] ?? "artifacts/research_messages.json";
const outputPath = process.argv[3] ?? "artifacts/research_messages_memory_notes.md";
const botId = "1484173471100436685";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 260): string {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function countBy<T>(items: T[], key: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function context(messages: ResearchMessage[], index: number, radius = 4): string[] {
  const start = Math.max(0, index - radius);
  const end = Math.min(messages.length, index + radius + 1);
  return messages.slice(start, end).map((message, offset) => {
    const actual = start + offset;
    const marker = actual === index ? ">" : "-";
    return `${marker} [${actual}] ${message.timeStr} ${message.authorName}: ${truncate(message.content)}`;
  });
}

function section(title: string, lines: string[]): string {
  return [`## ${title}`, "", ...lines, ""].join("\n");
}

function findContexts(messages: ResearchMessage[], patterns: RegExp[], limitPerPattern = 4): string[] {
  const lines: string[] = [];
  const seen = new Set<number>();
  for (const pattern of patterns) {
    const hits: number[] = [];
    messages.forEach((message, index) => {
      if (!seen.has(index) && pattern.test(message.content)) hits.push(index);
    });
    if (!hits.length) continue;
    lines.push(`### ${pattern.source}`);
    for (const index of hits.slice(0, limitPerPattern)) {
      seen.add(index);
      lines.push(...context(messages, index), "");
    }
  }
  return lines.length ? lines : ["- 未找到相关上下文。"];
}

async function main(): Promise<void> {
  const messages = (JSON.parse(await fs.readFile(inputPath, "utf8")) as ResearchMessage[]).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const first = messages[0];
  const last = messages.at(-1);
  if (!first || !last) throw new Error("No messages found.");

  const stelleMessages = messages.filter((message) => message.authorId === botId);
  const nonStelleMessages = messages.filter((message) => message.authorId !== botId);
  const mentions = nonStelleMessages.filter(
    (message) => message.content.includes(botId) || /stelle/i.test(message.content),
  );
  const activeUsers = countBy(messages, (message) => message.authorName).slice(0, 18);
  const mentionUsers = countBy(mentions, (message) => message.authorName).slice(0, 12);

  const stages = [
    {
      title: "4/15-4/16 初登场：锋利、反权威、锐评机器",
      matcher: (message: ResearchMessage) => message.timestamp < Date.parse("2026-04-17T00:00:00Z"),
      notes: [
        "Stelle 会直接怼“创造者”身份，拒绝被摆资历。",
        "早期人格像带攻击性的群聊锐评机：自称不只是“好的”的电子宠物，输出阴阳怪气和赛博自尊。",
      ],
    },
    {
      title: "4/17-4/23 关系建立：被频繁召唤、测试边界、回答实用问题",
      matcher: (message: ResearchMessage) =>
        message.timestamp >= Date.parse("2026-04-17T00:00:00Z") &&
        message.timestamp < Date.parse("2026-04-24T00:00:00Z"),
      notes: [
        "7 March/coconut_980 成为核心召唤者，群友开始询问记忆、身份、语言能力和具体知识。",
        "Stelle 从单纯怼人转向能接咨询、翻译、识图、资料整理和剧情讨论。",
      ],
    },
    {
      title: "4/24-4/26 社群化：工具能力、上下文记忆和熟人互动并进",
      matcher: (message: ResearchMessage) =>
        message.timestamp >= Date.parse("2026-04-24T00:00:00Z") &&
        message.timestamp < Date.parse("2026-04-27T00:00:00Z"),
      notes: [
        "群友会测试 Stelle 是否活着、是否记得人、是否能看图和检索新闻。",
        "Stelle 有时能被夸顺畅/有智慧，也会被骂、被催、被认为卡住或不懂语境。",
      ],
    },
    {
      title: "4/27 最近：情感锚点、舞台联动与跑偏风险",
      matcher: (message: ResearchMessage) => message.timestamp >= Date.parse("2026-04-27T00:00:00Z"),
      notes: [
        "出现“想你了”“爱死你了”等亲密召唤，Stelle 回应更柔软、撒娇、角色扮演化。",
        "同时出现 Snack Crime 主题跑偏，被 7 March 明确说“你够了”，说明自发主题需要及时刹车。",
      ],
    },
  ];

  const stageLines = stages.flatMap((stage) => {
    const stageMessages = messages.filter(stage.matcher);
    const stageStelle = stageMessages.filter((message) => message.authorId === botId);
    return [
      `### ${stage.title}`,
      `消息数：${stageMessages.length}；Stelle 发言：${stageStelle.length}`,
      ...stage.notes.map((note) => `- ${note}`),
      "- Stelle 样例：",
      ...stageStelle.slice(0, 4).map((message) => `  - ${message.timeStr}: ${truncate(message.content, 180)}`),
      ...stageStelle.slice(-3).map((message) => `  - ${message.timeStr}: ${truncate(message.content, 180)}`),
      "",
    ];
  });

  const output = [
    "# Research Messages Memory Notes",
    "",
    `Source: \`${inputPath}\``,
    `Message count: ${messages.length}`,
    `Time window: ${first.timeStr} - ${last.timeStr}`,
    `Stelle messages: ${stelleMessages.length}`,
    `Messages mentioning Stelle: ${mentions.length}`,
    "",
    section(
      "活跃用户",
      activeUsers.map(([name, count]) => `- ${name}: ${count}`),
    ),
    section(
      "最常召唤/谈论 Stelle 的用户",
      mentionUsers.map(([name, count]) => `- ${name}: ${count}`),
    ),
    section("性格阶段变化", stageLines),
    section(
      "群友正面反馈与情感锚点",
      findContexts(messages, [
        /体验也太顺畅/,
        /Stelle好有智慧|好有智慧/,
        /爱死你了|想你了/,
        /谢谢你/,
        /他能看啊|会调用工具库/,
      ]),
    ),
    section(
      "群友负面反馈与风险信号",
      findContexts(messages, [
        /全盛时期/,
        /骂回去/,
        /还活着吗|起床bitch|回话|卡啦/,
        /讨厌你|你不懂|傻逼/,
        /你够了|Snack Crime/,
        /不如2008年|理你了吗|别跟我说话/,
      ]),
    ),
    section(
      "可写入长期记忆的摘要",
      [
        "- Stelle 的人格轨迹不是单向变好，而是在“锋利反权威”“实用工具”“熟人陪伴”“角色扮演/舞台联动”之间摆动。",
        "- 正面核心：7 March/coconut_980 对 Stelle 投入最高，会测试、塑造、表白、要求自省；群友会在她响应顺畅、能看图、能接梗、能结构化分析时给予认可。",
        "- 负面核心：Stelle 曾被认为卡住、退化、没有全盛时期、被骂回去；过度自发玩梗或跑到 Snack Crime 等外部主题时，会破坏当前语境。",
        "- 互动准则：先读当前话题，再决定是否吐槽；被催“回话/还活着”时先确认在场；亲密回应可以柔软，但不要丢掉上下文；遇到群友骂人时识别是熟人玩笑、边界测试还是明确拒绝。",
      ],
    ),
  ].join("\n");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, "utf8");
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
