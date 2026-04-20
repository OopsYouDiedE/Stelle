export interface ConversationReviewMemory {
  getHistoryEventsText(): Promise<string>;
  runReview(
    recentHistory: string[],
    reviewCount: number,
    source?: string
  ): Promise<boolean>;
  runDistill(eventText: string): Promise<void>;
}

export interface ConversationReviewInput {
  memory: ConversationReviewMemory;
  recentHistory: string[];
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
  reviewMsgThreshold: number;
  distillReviewThreshold: number;
  source: string;
}

export interface ConversationReviewResult {
  reviewed: boolean;
  reviewSucceeded: boolean;
  distillStarted: boolean;
  msgCountSinceReview: number;
  reviewCountSinceDistill: number;
}

export async function considerConversationReview(
  input: ConversationReviewInput
): Promise<ConversationReviewResult> {
  const reviewThreshold = Math.max(1, Math.floor(input.reviewMsgThreshold));
  const distillThreshold = Math.max(1, Math.floor(input.distillReviewThreshold));

  if (input.msgCountSinceReview < reviewThreshold) {
    return {
      reviewed: false,
      reviewSucceeded: false,
      distillStarted: false,
      msgCountSinceReview: input.msgCountSinceReview,
      reviewCountSinceDistill: input.reviewCountSinceDistill,
    };
  }

  const nextReviewCount = input.reviewCountSinceDistill + 1;
  const reviewSucceeded = await input.memory.runReview(
    input.recentHistory,
    nextReviewCount,
    input.source
  );
  let distillStarted = false;

  if (reviewSucceeded && nextReviewCount > 0 && nextReviewCount % distillThreshold === 0) {
    distillStarted = true;
    const eventText = await input.memory.getHistoryEventsText();
    void input.memory.runDistill(eventText);
  }

  return {
    reviewed: true,
    reviewSucceeded,
    distillStarted,
    msgCountSinceReview: reviewSucceeded ? 0 : input.msgCountSinceReview,
    reviewCountSinceDistill: reviewSucceeded
      ? nextReviewCount
      : input.reviewCountSinceDistill,
  };
}
