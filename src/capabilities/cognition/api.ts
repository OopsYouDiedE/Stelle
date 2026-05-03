import { ContextBuilder } from "./context_builder.js";
import { IntentGenerator } from "./intent_generator.js";
import { Explainer } from "./explainer.js";
import type { CognitiveContext, CandidateIntent } from "./schemas.js";
import type { StateWatermark } from "../../core/protocol/state_watermark.js";
import type { DecisionTrace } from "../../core/execution/cycle_journal.js";
import type { LlmClient } from "../model/llm.js";

export interface BuildContextInput {
  cycleId: string;
  agentId: string;
  lane: "reply" | "proactive" | "world" | "stage";
  observations: any[];
  memoryHits: any[];
  worldView?: any;
  watermarks: StateWatermark;
}

export interface CognitionApi {
  /**
   * 构建认知上下文
   */
  build_context(input: BuildContextInput): Promise<CognitiveContext>;

  /**
   * 生成候选意图
   */
  generate_intents(ctx: CognitiveContext): Promise<CandidateIntent[]>;

  /**
   * 解释决策选择
   */
  explain_choice(trace: DecisionTrace): Promise<string>;
}

export class CognitionCapability implements CognitionApi {
  private readonly builder = new ContextBuilder();
  private readonly generator: IntentGenerator;
  private readonly explainer: Explainer;

  constructor(llm: LlmClient) {
    this.generator = new IntentGenerator(llm);
    this.explainer = new Explainer(llm);
  }

  public async build_context(input: BuildContextInput): Promise<CognitiveContext> {
    return this.builder.build(input);
  }

  public async generate_intents(ctx: CognitiveContext): Promise<CandidateIntent[]> {
    return this.generator.generate(ctx);
  }

  public async explain_choice(trace: DecisionTrace): Promise<string> {
    return this.explainer.explain(trace);
  }
}
