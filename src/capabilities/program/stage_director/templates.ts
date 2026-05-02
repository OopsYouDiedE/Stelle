import type { ChatClusterLabel, ProgramMode, TopicPhase } from "./types.js";

export interface ProgramTemplate {
  id: string;
  title: string;
  mode: ProgramMode;
  safeTopicKinds: string[];
  phaseFlow: TopicPhase[];
  clusterLabels: ChatClusterLabel[];
  summaryPrompt: string;
  memoryPolicy: "none" | "public_episode_summary" | "public_proposal_only";
  excludedTopics: string[];
}

const COMMON_EXCLUDED = ["政治", "时事", "医疗诊断", "法律定性", "金融投资", "具体个人审判", "隐私爆料"];

export const PROGRAM_TEMPLATES: ProgramTemplate[] = [
  {
    id: "human_behavior_observation",
    title: "人类行为观察",
    mode: "observation",
    safeTopicKinds: ["AI 行为", "直播互动", "观众偏好", "创作心理"],
    phaseFlow: ["opening", "sampling", "clustering", "summarizing", "closing"],
    clusterLabels: ["question", "opinion", "joke", "challenge", "other"],
    summaryPrompt: "总结观众为什么这样互动，避免心理诊断，只做行为观察。",
    memoryPolicy: "public_episode_summary",
    excludedTopics: COMMON_EXCLUDED,
  },
  {
    id: "audience_court",
    title: "输入法庭",
    mode: "court",
    safeTopicKinds: ["AI 边界", "直播规则", "虚拟主播伦理", "节目设定"],
    phaseFlow: ["opening", "sampling", "debating", "summarizing", "closing"],
    clusterLabels: ["opinion", "challenge", "question", "other"],
    summaryPrompt: "整理正方、反方和折中方案，不裁判现实个人。",
    memoryPolicy: "public_episode_summary",
    excludedTopics: COMMON_EXCLUDED,
  },
  {
    id: "prompt_lab",
    title: "Prompt 实验室",
    mode: "lab",
    safeTopicKinds: ["回答风格", "提示词实验", "表达比较"],
    phaseFlow: ["opening", "sampling", "clustering", "summarizing"],
    clusterLabels: ["question", "opinion", "joke", "challenge"],
    summaryPrompt: "比较不同回答风格的节目效果，不改主 prompt。",
    memoryPolicy: "none",
    excludedTopics: COMMON_EXCLUDED,
  },
  {
    id: "memory_recall_night",
    title: "记忆回收夜",
    mode: "archive",
    safeTopicKinds: ["公共节目记忆", "上期复盘", "低敏设定"],
    phaseFlow: ["opening", "sampling", "summarizing", "closing"],
    clusterLabels: ["setting_suggestion", "opinion", "question", "other"],
    summaryPrompt: "只回顾公共、低敏、节目化记忆。",
    memoryPolicy: "public_episode_summary",
    excludedTopics: [...COMMON_EXCLUDED, "个人历史", "观众私生活"],
  },
  {
    id: "worldbuilding",
    title: "共创世界观",
    mode: "story",
    safeTopicKinds: ["虚构设定", "档案馆", "实验室", "世界观规则"],
    phaseFlow: ["opening", "sampling", "clustering", "debating", "summarizing", "closing"],
    clusterLabels: ["setting_suggestion", "question", "opinion", "challenge", "other"],
    summaryPrompt: "把新设定放入 proposal，不直接确认 canon。",
    memoryPolicy: "public_proposal_only",
    excludedTopics: COMMON_EXCLUDED,
  },
  {
    id: "viewer_diagnosis",
    title: "观众问题诊断局",
    mode: "diagnosis",
    safeTopicKinds: ["学习计划", "创作卡壳", "项目拆解", "直播策划", "目标规划"],
    phaseFlow: ["opening", "sampling", "clustering", "summarizing", "closing"],
    clusterLabels: ["question", "opinion", "challenge", "other"],
    summaryPrompt: "给出非专业、非高风险的行动拆解。",
    memoryPolicy: "none",
    excludedTopics: [...COMMON_EXCLUDED, "心理危机", "医疗建议", "法律判断", "投资决策"],
  },
  {
    id: "ai_reflection",
    title: "AI 反省会",
    mode: "reflection",
    safeTopicKinds: ["行为策略", "节目复盘", "回答质量", "直播节奏"],
    phaseFlow: ["opening", "sampling", "summarizing", "closing"],
    clusterLabels: ["opinion", "challenge", "question", "other"],
    summaryPrompt: "说行为策略复盘，不声称真实意识进化。",
    memoryPolicy: "public_episode_summary",
    excludedTopics: COMMON_EXCLUDED,
  },
];

export function getProgramTemplate(id: string | undefined): ProgramTemplate {
  return PROGRAM_TEMPLATES.find((template) => template.id === id) ?? PROGRAM_TEMPLATES[0]!;
}

export function isTemplateTopicAllowed(template: ProgramTemplate, text: string): boolean {
  return !template.excludedTopics.some((topic) => text.includes(topic));
}
