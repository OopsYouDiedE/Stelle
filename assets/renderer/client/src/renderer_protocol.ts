export interface RendererCommand {
  type?: string;
  text?: string;
  speaker?: string;
  rateMs?: number;
  state?: { caption?: string; speaker?: string; background?: string };
  lane?: "incoming" | "response" | "topic" | "system";
  userName?: string;
  priority?: "low" | "medium" | "high";
  note?: string;
  url?: string;
  expression?: string;
  group?: string;
  source?: string;
  status?: string;
  provider?: string;
  widget?: ProgramWidgetName;
  scene?: string;
  background?: string;
}

export type ProgramWidgetName =
  | "topic_compass"
  | "chat_cluster"
  | "conclusion_board"
  | "question_queue"
  | "public_memory_wall"
  | "stage_status"
  | "world_canon"
  | "prompt_lab"
  | "anonymous_community_map";

export interface TopicState {
  title?: string;
  mode?: string;
  phase?: string;
  currentQuestion?: string;
  nextQuestion?: string;
  clusters?: Array<{ label: string; count: number; representative?: string }>;
  conclusions?: string[];
  pendingQuestions?: string[];
  scene?: string;
}

export interface BilibiliFixtureEvent {
  id: string;
  cmd: string;
  priority: "low" | "medium" | "high";
  receivedAt: string;
  raw: unknown;
  normalized?: {
    userId?: number | string;
    userName?: string;
    text?: string;
    eventType?: string;
  };
}
