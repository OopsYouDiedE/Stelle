import type { ProgramWidgetName, TopicState } from "./renderer_protocol";

const programTopicTitle = document.querySelector<HTMLHeadingElement>("#program-topic-title");
const programTopicPhase = document.querySelector<HTMLParagraphElement>("#program-topic-phase");
const programCurrentQuestion = document.querySelector<HTMLParagraphElement>("#program-current-question");
const programNextQuestion = document.querySelector<HTMLParagraphElement>("#program-next-question");
const programClusters = document.querySelector<HTMLOListElement>("#program-clusters");
const programConclusions = document.querySelector<HTMLOListElement>("#program-conclusions");
const programQuestions = document.querySelector<HTMLOListElement>("#program-questions");
const programStageStatus = document.querySelector<HTMLDListElement>("#program-stage-status");
const programPublicMemories = document.querySelector<HTMLOListElement>("#program-public-memories");
const programWorldCanon = document.querySelector<HTMLOListElement>("#program-world-canon");
const programPromptLab = document.querySelector<HTMLOListElement>("#program-prompt-lab");
const programCommunityMap = document.querySelector<HTMLOListElement>("#program-community-map");

export function applyTopicState(value: unknown): void {
  const state = asRecord(value) as TopicState;
  if (programTopicTitle) programTopicTitle.textContent = String(state.title ?? "今日议题");
  if (programTopicPhase)
    programTopicPhase.textContent = [state.mode, state.phase].filter(Boolean).join(" / ") || "opening";
  if (programCurrentQuestion) programCurrentQuestion.textContent = String(state.currentQuestion ?? "");
  if (programNextQuestion) programNextQuestion.textContent = state.nextQuestion ? `下一问：${state.nextQuestion}` : "";
  if (state.scene) applyProgramScene(String(state.scene));
  renderClusterList(state.clusters ?? []);
  renderTextList(programConclusions, state.conclusions ?? [], "暂未形成结论");
  renderTextList(programQuestions, state.pendingQuestions ?? [], "暂无待回答问题");
}

export function applyWidgetState(widget: ProgramWidgetName | undefined, state: unknown): void {
  const raw = asRecord(state);
  // Widget payloads are intentionally routed through one entry point so the renderer
  // can stay agnostic of which live controller emitted the state.
  if (widget === "topic_compass") applyTopicState(raw);
  if (widget === "chat_cluster") renderClusterList(Array.isArray(raw.clusters) ? (raw.clusters as any[]) : []);
  if (widget === "conclusion_board") renderTextList(programConclusions, stringArray(raw.conclusions), "暂未形成结论");
  if (widget === "question_queue")
    renderTextList(programQuestions, stringArray(raw.pendingQuestions), "暂无待回答问题");
  if (widget === "stage_status") renderStageStatus(raw);
  if (widget === "public_memory_wall") renderPublicMemories(raw);
  if (widget === "world_canon") renderWorldCanon(raw);
  if (widget === "prompt_lab") renderPromptLab(raw);
  if (widget === "anonymous_community_map") renderCommunityMap(raw);
}

export function applyProgramScene(scene: string, background?: string): void {
  document.body.dataset.programScene = scene || "observation";
  if (background) applyBackground(background);
}

function renderClusterList(clusters: Array<{ label?: string; count?: number; representative?: string }>): void {
  if (!programClusters) return;
  programClusters.innerHTML = "";
  const visible = clusters.filter((item) => Number(item.count ?? 0) > 0).slice(0, 6);
  if (!visible.length) {
    appendListItem(programClusters, "等待弹幕采样");
    return;
  }
  for (const cluster of visible) {
    const body = [
      clusterLabel(String(cluster.label ?? "other")),
      `${Number(cluster.count ?? 0)} 条`,
      cluster.representative,
    ]
      .filter(Boolean)
      .join(" · ");
    appendListItem(programClusters, body);
  }
}

function renderTextList(target: HTMLOListElement | null, items: string[], emptyText: string): void {
  if (!target) return;
  target.innerHTML = "";
  const visible = items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!visible.length) {
    appendListItem(target, emptyText);
    return;
  }
  for (const item of visible) appendListItem(target, item);
}

function renderStageStatus(raw: Record<string, unknown>): void {
  if (!programStageStatus) return;
  programStageStatus.innerHTML = "";
  const stage = asRecord(raw.stage);
  const health = asRecord(raw.health);
  const entries = {
    stage: String(stage.status ?? asRecord(health.stageOutput).status ?? "unknown"),
    lane: String(stage.lane ?? asRecord(health.stageOutput).currentLane ?? "none"),
    queue: String(asRecord(health.stageOutput).queueLength ?? "0"),
    tts: String(asRecord(health.tts).lastError ? "error" : (asRecord(health.tts).lastProvider ?? "idle")),
  };
  for (const [key, value] of Object.entries(entries)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    programStageStatus.append(dt, dd);
  }
}

function renderPublicMemories(raw: Record<string, unknown>): void {
  if (!programPublicMemories) return;
  programPublicMemories.innerHTML = "";
  const memories = Array.isArray(raw.memories) ? raw.memories.slice(0, 6) : [];
  if (!memories.length) {
    appendListItem(programPublicMemories, "暂无公开节目记忆");
    return;
  }
  for (const item of memories) {
    const record = asRecord(item);
    const title = String(record.title ?? "节目记忆");
    const summary = String(record.summary ?? "");
    appendListItem(programPublicMemories, summary ? `${title}：${summary}` : title);
  }
}

function renderWorldCanon(raw: Record<string, unknown>): void {
  if (!programWorldCanon) return;
  programWorldCanon.innerHTML = "";
  const entries = Array.isArray(raw.entries) ? raw.entries.slice(0, 6) : [];
  if (!entries.length) {
    appendListItem(programWorldCanon, "暂无世界观条目");
    return;
  }
  for (const item of entries) {
    const record = asRecord(item);
    const status = String(record.status ?? "proposed");
    const title = String(record.title ?? "设定");
    appendListItem(programWorldCanon, `[${status}] ${title}`);
  }
}

function renderPromptLab(raw: Record<string, unknown>): void {
  if (!programPromptLab) return;
  programPromptLab.innerHTML = "";
  const experiments = Array.isArray(raw.experiments) ? raw.experiments.slice(0, 2) : [];
  if (!experiments.length) {
    appendListItem(programPromptLab, "暂无沙盒实验");
    return;
  }
  for (const item of experiments) {
    const record = asRecord(item);
    const question = String(record.question ?? "实验");
    const variants = Array.isArray(record.variants) ? record.variants.length : 0;
    appendListItem(programPromptLab, `${question} · ${variants} 个风格`);
  }
}

function renderCommunityMap(raw: Record<string, unknown>): void {
  if (!programCommunityMap) return;
  programCommunityMap.innerHTML = "";
  const heat = Array.isArray(raw.heat) ? raw.heat.slice(0, 6) : [];
  if (!heat.length) {
    appendListItem(programCommunityMap, "等待匿名热度样本");
    return;
  }
  for (const item of heat) {
    const record = asRecord(item);
    appendListItem(
      programCommunityMap,
      `${clusterLabel(String(record.label ?? "other"))} · ${record.count ?? 0} · ${record.intensity ?? 0}%`,
    );
  }
}

function appendListItem(target: HTMLOListElement, text: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  target.append(li);
}

function applyBackground(source: string): void {
  if (!source) return;
  document.documentElement.style.setProperty("--stage-background-image", `url("${source}")`);
}

function clusterLabel(value: string): string {
  const labels: Record<string, string> = {
    question: "问题",
    opinion: "观点",
    joke: "吐槽",
    setting_suggestion: "设定建议",
    challenge: "挑战",
    other: "其他",
  };
  return labels[value] ?? value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
