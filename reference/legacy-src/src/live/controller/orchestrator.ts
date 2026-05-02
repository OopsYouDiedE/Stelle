// === Imports ===
import { moderateLiveEvent, normalizeLiveEvent, type NormalizedLiveEvent } from "../../utils/live_event.js";
import { sanitizeExternalText, truncateText } from "../../utils/text.js";
import type { PublicRoomMemory } from "./public_memory.js";
import type { WorldCanonEntry } from "./world_canon.js";
import type { PromptLabExperiment } from "./prompt_lab.js";
import { buildAnonymousCommunityMap } from "./community_map.js";
import { getProgramTemplate } from "./templates.js";
import type {
  ChatCluster,
  ChatClusterLabel,
  ChatClusterState,
  ProgramEventSample,
  ProgramMode,
  ProgramWidgetState,
  StageStatusWidgetState,
  TopicOrchestratorOptions,
  TopicPhase,
  TopicState,
} from "./types.js";

// === Constants ===
const DEFAULT_TOPIC = "AI 主播应不应该记住观众？";
const DEFAULT_QUESTION = "如果可以一键让 Stelle 忘记你，你会更愿意互动吗？";
const CLUSTER_ORDER: ChatClusterLabel[] = ["question", "opinion", "joke", "setting_suggestion", "challenge", "other"];

// === Main Class ===
export class TopicOrchestrator {
  private readonly now: () => number;
  private readonly maxSamples: number;
  private readonly maxPendingQuestions: number;
  private samples: ProgramEventSample[] = [];
  private clusterCounts = new Map<ChatClusterLabel, number>();
  private clusterRepresentatives = new Map<ChatClusterLabel, string>();
  private pendingQuestions: string[] = [];
  private conclusions: string[] = [];
  private stageStatus: StageStatusWidgetState;
  private state: TopicState;

  constructor(options: TopicOrchestratorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxSamples = options.maxSamples ?? 120;
    this.maxPendingQuestions = options.maxPendingQuestions ?? 8;
    const template = getProgramTemplate(options.templateId);
    const mode = options.mode ?? template.mode;
    this.state = {
      topicId: options.topicId ?? `topic-${this.now()}`,
      title: options.title ?? (template.id === "human_behavior_observation" ? DEFAULT_TOPIC : template.title),
      mode,
      phase: "opening",
      currentQuestion: options.currentQuestion ?? DEFAULT_QUESTION,
      nextQuestion: options.nextQuestion ?? "你希望 AI 记住的是偏好、共同设定，还是完全不要记？",
      clusters: [],
      conclusions: [],
      pendingQuestions: [],
      scene: mode,
      lastUpdatedAt: this.now(),
    };
    this.stageStatus = { updatedAt: this.now() };
  }

  // === Event Ingestion ===

  ingestLivePayload(payload: Record<string, unknown>): ReturnType<TopicOrchestrator["ingestEvent"]> {
    const event = normalizeLiveEvent(payload);
    return this.ingestEvent(event);
  }

  ingestEvent(event: NormalizedLiveEvent): {
    updated: boolean;
    state: TopicState;
    reason: string;
    transition?: { phaseChanged: boolean; from?: TopicPhase; to?: TopicPhase };
  } {
    if (event.kind !== "danmaku" && event.kind !== "super_chat") {
      return { updated: false, state: this.snapshot(), reason: "non_discussion_event" };
    }
    const moderation = moderateLiveEvent(event);
    if (!moderation.allowed) {
      return { updated: false, state: this.snapshot(), reason: `moderation_${moderation.category ?? "rejected"}` };
    }
    const text = safePublicText(event.text);
    if (!text) return { updated: false, state: this.snapshot(), reason: "empty_text" };

    const label = classifyText(text);
    this.samples.push({
      id: event.id,
      source: event.source,
      kind: event.kind,
      text,
      receivedAt: event.receivedAt,
      priority: event.priority,
    });
    if (this.samples.length > this.maxSamples) this.samples.shift();

    this.clusterCounts.set(label, (this.clusterCounts.get(label) ?? 0) + 1);
    if (
      !this.clusterRepresentatives.has(label) ||
      shouldReplaceRepresentative(text, this.clusterRepresentatives.get(label))
    ) {
      this.clusterRepresentatives.set(label, text);
    }
    if (label === "question") this.pushQuestion(text);

    const transition = this.refreshState();
    return {
      updated: true,
      state: this.snapshot(),
      reason: label,
      ...(transition.phaseChanged ? { transition } : {}),
    };
  }

  recordBatchFlush(payload: Record<string, unknown>): void {
    const size = Number(payload.size ?? 0);
    if (size >= 5 && this.state.phase === "sampling") {
      this.setPhase("clustering");
    }
  }

  // === State Updates ===

  updateStageStatus(input: { stage?: Record<string, unknown>; health?: Record<string, unknown> }): void {
    this.stageStatus = { ...input, updatedAt: this.now() };
  }

  setMode(mode: ProgramMode): TopicState {
    this.state = { ...this.state, mode, scene: mode, lastUpdatedAt: this.now() };
    return this.snapshot();
  }

  updateTopic(title: string, currentQuestion: string): void {
    this.state = { ...this.state, title, currentQuestion, lastUpdatedAt: this.now() };
  }

  setPhase(phase: TopicPhase): { updated: boolean; from?: TopicPhase; to?: TopicPhase } {
    if (this.state.phase === phase) return { updated: false };
    const from = this.state.phase;
    this.state = { ...this.state, phase, lastUpdatedAt: this.now() };
    return { updated: true, from, to: phase };
  }

  refreshState(): { phaseChanged: boolean; from?: TopicPhase; to?: TopicPhase } {
    const oldPhase = this.state.phase;
    const currentClusters = this.clusters();
    const phase = phaseForSampleCount(this.samples.length, this.conclusions.length);

    this.conclusions = buildConclusions(currentClusters, this.pendingQuestions);
    this.state = {
      ...this.state,
      phase,
      clusters: currentClusters,
      conclusions: [...this.conclusions],
      pendingQuestions: [...this.pendingQuestions],
      lastUpdatedAt: this.now(),
    };

    return {
      phaseChanged: oldPhase !== phase,
      from: oldPhase,
      to: phase,
    };
  }

  // === Query & Snapshot ===

  snapshot(): TopicState {
    return {
      ...this.state,
      clusters: this.clusters(),
      conclusions: [...this.conclusions],
      pendingQuestions: [...this.pendingQuestions],
    };
  }

  widgetState(
    publicMemories: PublicRoomMemory[] = [],
    worldCanon: WorldCanonEntry[] = [],
    promptLab: PromptLabExperiment[] = [],
  ): ProgramWidgetState {
    const updatedAt = this.now();
    const currentSnapshot = this.snapshot();

    return {
      topic_compass: currentSnapshot,
      chat_cluster: this.chatClusterState(),
      conclusion_board: { conclusions: [...this.conclusions], updatedAt },
      question_queue: { pendingQuestions: [...this.pendingQuestions], updatedAt },
      stage_status: { ...this.stageStatus },
      public_memory_wall: { memories: publicMemories, updatedAt },
      world_canon: { entries: worldCanon, updatedAt },
      prompt_lab: { experiments: promptLab, updatedAt },
      anonymous_community_map: buildAnonymousCommunityMap({
        clusters: currentSnapshot.clusters,
        samples: this.samples.slice(-40),
        now: this.now,
      }),
    };
  }

  chatClusterState(): ChatClusterState {
    return {
      clusters: this.clusters(),
      samples: this.samples.slice(-20),
      updatedAt: this.now(),
    };
  }

  // === Private Methods ===

  private clusters(): ChatCluster[] {
    return CLUSTER_ORDER.map((label) => ({
      label,
      count: this.clusterCounts.get(label) ?? 0,
      representative: this.clusterRepresentatives.get(label),
    })).filter((cluster) => cluster.count > 0);
  }

  private pushQuestion(text: string): void {
    if (this.pendingQuestions.some((item) => similarQuestion(item, text))) return;
    this.pendingQuestions.push(text);
    if (this.pendingQuestions.length > this.maxPendingQuestions) {
      this.pendingQuestions.shift();
    }
  }
}

// === Global Helpers ===

export function classifyText(text: string): ChatClusterLabel {
  const clean = text.trim();
  if (/[?？吗呢]|怎么|为什么|能不能|是否|该不该|要不要/u.test(clean)) return "question";
  if (/设定|世界观|规则|档案馆|人格|记忆|提案|投票/u.test(clean)) return "setting_suggestion";
  if (/不应该|反对|挑战|质疑|漏洞|错了|不同意|凭什么/u.test(clean)) return "challenge";
  if (/哈哈|笑死|草|乐|绷|好玩|整活|猫娘|阴阳怪气/u.test(clean)) return "joke";
  if (/我觉得|我认为|支持|赞成|希望|害怕|担心|接受|反感/u.test(clean)) return "opinion";
  return "other";
}

function safePublicText(text: string): string {
  return truncateText(sanitizeExternalText(text).replace(/@\S+/g, "").trim(), 90);
}

function shouldReplaceRepresentative(next: string, previous?: string): boolean {
  if (!previous) return true;
  if (next.length > previous.length && next.length <= 90) return true;
  return /[?？]/.test(next) && !/[?？]/.test(previous);
}

function phaseForSampleCount(count: number, conclusionCount: number): TopicPhase {
  if (count <= 0) return "opening";
  if (count < 5) return "sampling";
  if (count < 12) return "clustering";
  if (conclusionCount >= 3) return "summarizing";
  return "debating";
}

function buildConclusions(clusters: ChatCluster[], questions: string[]): string[] {
  const conclusions: string[] = [];
  const top = [...clusters].sort((a, b) => b.count - a.count)[0];
  if (top) {
    conclusions.push(`弹幕目前最集中在“${clusterTitle(top.label)}”，已有 ${top.count} 条相关输入。`);
  }

  if (clusters.some((c) => c.label === "opinion")) {
    conclusions.push("观众正在给出偏好和边界，适合继续追问可接受的记忆范围。");
  }

  if (questions.length > 0) {
    conclusions.push(`待回答问题里最新的一条是：${questions.at(-1)}`);
  }
  return conclusions.slice(0, 3);
}

function clusterTitle(label: ChatClusterLabel): string {
  const titles: Record<ChatClusterLabel, string> = {
    question: "问题",
    opinion: "观点",
    joke: "吐槽/玩笑",
    setting_suggestion: "设定建议",
    challenge: "挑战/质疑",
    other: "其他",
  };
  return titles[label];
}

function similarQuestion(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length, 12);
  return a.startsWith(b.slice(0, minLen)) || b.startsWith(a.slice(0, minLen));
}
