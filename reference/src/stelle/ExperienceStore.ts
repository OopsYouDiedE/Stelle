import type { CursorReport } from "../cursors/base.js";
import type { Experience, ExperienceStoreSnapshot } from "./types.js";

export interface ExperienceSource {
  cursorId: string;
  kind: string;
}

export class ExperienceStore {
  private readonly items: Experience[] = [];
  private readonly relationshipWeights = new Map<string, number>();
  private readonly topicWeights = new Map<string, number>();
  private nextId = 1;

  constructor(private readonly maxItems = 500) {}

  appendReport(report: CursorReport, source: ExperienceSource): Experience {
    this.updateSubjectiveWeights(report, source);
    const experience: Experience = {
      id: `exp-${this.nextId++}`,
      sourceCursorId: source.cursorId,
      sourceKind: source.kind,
      type: report.type,
      summary: report.summary,
      payload: report.payload,
      salience: this.inferSalience(report, source),
      occurredAt: report.timestamp,
      receivedAt: Date.now(),
    };
    this.items.push(experience);
    this.trim();
    return experience;
  }

  appendReports(
    reports: readonly CursorReport[],
    resolveSource: (report: CursorReport) => ExperienceSource
  ): void {
    for (const report of reports) {
      this.appendReport(report, resolveSource(report));
    }
  }

  recent(limit = 24): Experience[] {
    return this.items.slice(Math.max(0, this.items.length - limit));
  }

  snapshot(limit = 12): ExperienceStoreSnapshot {
    return {
      totalCount: this.items.length,
      recent: this.recent(limit),
    };
  }

  private trim(): void {
    if (this.items.length > this.maxItems) {
      this.items.splice(0, this.items.length - this.maxItems);
    }
  }

  private updateSubjectiveWeights(
    report: CursorReport,
    source: ExperienceSource
  ): void {
    if (source.kind !== "discord") return;
    const authorId = payloadString(report.payload, "authorId");
    const content = payloadString(report.payload, "content");
    if (!authorId || !content) return;

    const current = this.relationshipWeights.get(authorId) ?? 0.5;
    const next = clamp(current + interactionDelta(content), 0.25, 1);
    this.relationshipWeights.set(authorId, next);

    for (const topic of extractInterestTopics(content)) {
      const weight = this.topicWeights.get(topic) ?? 0.5;
      this.topicWeights.set(topic, clamp(weight + 0.04, 0.3, 1));
    }
  }

  private inferSalience(report: CursorReport, source: ExperienceSource): number {
    const type = report.type.toLowerCase();
    let score = 0.5;
    if (type.includes("error") || type.includes("failed")) score = 0.9;
    else if (type.includes("message") || type.includes("interaction")) score = 0.65;
    else if (type.includes("complete") || type.includes("done")) score = 0.7;
    else if (type.includes("typing") || type.includes("snapshot")) score = 0.35;

    if (source.kind === "discord") {
      const authorId = payloadString(report.payload, "authorId");
      const content = payloadString(report.payload, "content");
      const relationship = authorId
        ? this.relationshipWeights.get(authorId) ?? 0.5
        : 0.5;
      score += (relationship - 0.5) * 0.25;
      score += content ? interestBoost(content) : 0;
      score += topicBoost(content, this.topicWeights);
    }

    return clamp(score, 0.1, 1);
  }
}

function payloadString(
  payload: Record<string, unknown> | undefined,
  key: string
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function interactionDelta(content: string): number {
  if (isDismissiveOrSpammy(content)) return -0.03;
  if (looksLikeQuestionOrRequest(content)) return 0.04;
  if (interestBoost(content) > 0.08) return 0.03;
  return 0.01;
}

function looksLikeQuestionOrRequest(content: string): boolean {
  return /[?？]|帮我|请|能不能|可不可以|怎么|为什么|如何|what|why|how|could you|can you/i.test(
    content
  );
}

function isDismissiveOrSpammy(content: string): boolean {
  const compact = content.replace(/\s+/g, "");
  if (compact.length >= 16) {
    const counts = new Map<string, number>();
    for (const char of compact) counts.set(char, (counts.get(char) ?? 0) + 1);
    if (Math.max(...counts.values()) / compact.length > 0.55) return true;
  }
  return /闭嘴|别说话|无聊|bot|机器人|随便玩玩|ignore/i.test(content);
}

function interestBoost(content: string): number {
  let boost = 0;
  if (/Stelle|你自己|意识|记忆|智能体|主体|agent|memory|conscious/i.test(content)) {
    boost += 0.12;
  }
  if (/Minecraft|浏览器|网页|代码|架构|调试|实现|项目|工具|cursor|browser/i.test(content)) {
    boost += 0.08;
  }
  if (/喜欢|感兴趣|想法|怎么看|觉得|陪我|一起/i.test(content)) {
    boost += 0.05;
  }
  if (isDismissiveOrSpammy(content)) boost -= 0.1;
  return boost;
}

function extractInterestTopics(content: string): string[] {
  const topics = [
    "stelle",
    "智能体",
    "意识",
    "记忆",
    "minecraft",
    "browser",
    "代码",
    "架构",
    "discord",
  ];
  const lower = content.toLowerCase();
  return topics.filter((topic) => lower.includes(topic.toLowerCase()));
}

function topicBoost(content: string | null, topics: ReadonlyMap<string, number>): number {
  if (!content) return 0;
  const lower = content.toLowerCase();
  let boost = 0;
  for (const [topic, weight] of topics) {
    if (lower.includes(topic.toLowerCase())) {
      boost += (weight - 0.5) * 0.1;
    }
  }
  return Math.min(boost, 0.08);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
