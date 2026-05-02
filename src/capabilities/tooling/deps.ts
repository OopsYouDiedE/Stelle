export interface ToolRegistryDeps {
  cwd?: string;
  discord?: DiscordToolRuntime;
  live?: LiveToolRuntime;
  memory?: MemoryToolStore;
  tts?: StreamingTtsToolProvider;
  sceneObserver?: SceneToolObserver;
  eventBus?: ToolEventBus;
}

export interface ToolEventBus {
  publish(event: { type: string; source: string } & Record<string, unknown>): void;
}

export interface SceneToolObserver {
  observe(): Promise<unknown>;
}

export interface StreamingTtsToolProvider {
  synthesizeStream(input: unknown): Promise<unknown>;
}

export interface MemoryToolStore {
  writeRecent(scope: unknown, event: unknown): Promise<void>;
  proposeMemory(input: unknown): Promise<string>;
  listMemoryProposals(limit: number, status: "pending" | "approved" | "rejected"): Promise<unknown[]>;
  approveMemoryProposal(id: string, input: unknown): Promise<unknown>;
  rejectMemoryProposal(id: string, input: unknown): Promise<unknown>;
  readRecent(scope: unknown, limit: number): Promise<unknown[]>;
  searchHistory(scope: unknown, query: unknown): Promise<unknown[]>;
  readLongTerm(key: string, layer: string): Promise<unknown>;
  writeLongTerm(key: string, value: string, layer: string): Promise<void>;
  appendLongTerm(key: string, value: string, layer: string): Promise<void>;
  appendResearchLog(input: unknown): Promise<string>;
}

export interface DiscordToolRuntime {
  getStatus(): Promise<unknown>;
  getMessage(channelId: string, messageId: string): Promise<{ id: string }>;
  getChannelHistory(input: { channelId: string; limit?: number }): Promise<unknown[]>;
  sendMessage(input: {
    channelId: string;
    content: string;
    mentionUserIds?: string[];
    replyToMessageId?: string;
  }): Promise<{ id: string }>;
}

export interface LiveToolRuntime {
  obs: {
    startStream(): Promise<LiveToolActionResult>;
    stopStream(): Promise<LiveToolActionResult>;
    setCurrentScene(sceneName: string): Promise<LiveToolActionResult>;
  };
  getStatus(): Promise<{ obs?: unknown } & Record<string, unknown>>;
  setCaption(text: string): Promise<LiveToolActionResult>;
  streamCaption(text: string, speaker?: string, rateMs?: number): Promise<LiveToolActionResult>;
  pushEvent(input: {
    eventId?: string;
    lane: "incoming" | "response" | "topic" | "system";
    text: string;
    userName?: string;
    priority?: "low" | "medium" | "high";
    note?: string;
  }): Promise<LiveToolActionResult>;
  triggerMotion(group: string, priority?: "normal" | "force"): Promise<LiveToolActionResult>;
  setExpression(expression: string): Promise<LiveToolActionResult>;
  clearCaption(): Promise<LiveToolActionResult>;
  stopAudio(): Promise<LiveToolActionResult>;
  playTtsStream(text: string, request: Record<string, unknown>): Promise<LiveToolActionResult>;
}

export interface LiveToolActionResult {
  ok: boolean;
  summary: string;
  error?: { code: string; message: string; retryable: boolean };
}
