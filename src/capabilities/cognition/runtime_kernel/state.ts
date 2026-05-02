export interface RuntimeKernelState {
  currentPersonaId: string;
  mood: string;
  attentionFocus?: string;
  recentEventIds: string[];
  counters: Record<string, number>;
  lastTickTimestamp: number;
  stageBusy: boolean;
  queuedIntentIds: string[];
}

export function createInitialState(): RuntimeKernelState {
  return {
    currentPersonaId: "default",
    mood: "neutral",
    recentEventIds: [],
    counters: {},
    lastTickTimestamp: Date.now(),
    stageBusy: false,
    queuedIntentIds: [],
  };
}
