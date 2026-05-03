import { z } from "zod";

/**
 * 候选意图 Schema
 */
export const CandidateIntentSchema = z.object({
  intentId: z.string(),
  actorId: z.string(),
  scope: z.enum(["reply", "world", "stage", "memory", "tool"]),
  summary: z.string(),
  desiredOutcome: z.string(),
  targetRefs: z.array(z.any()).optional(),
  requiredAffordanceHints: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.any()),
  justification: z.string(),
});

export type CandidateIntent = z.infer<typeof CandidateIntentSchema>;

/**
 * 认知上下文 Schema
 */
export const CognitiveContextSchema = z.object({
  cycleId: z.string(),
  agentId: z.string(),
  lane: z.enum(["reply", "proactive", "world", "stage"]),
  observations: z.array(z.any()),
  memoryHits: z.array(z.any()),
  worldView: z.any().optional(),
  watermarks: z.any(),
});

export type CognitiveContext = z.infer<typeof CognitiveContextSchema>;
