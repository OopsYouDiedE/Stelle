import { describe, expect, it } from "vitest";
import { hasEvalLlmKeys, evalModelLabel, makeEvalLlm } from "../utils/env.js";
import { recordEvalCase } from "../utils/report.js";
import { maybeAssertScore, summarizeChecks } from "../utils/scoring.js";
import { SemanticClusterService } from "../../src/capabilities/memory/store/semantic.js";

/**
 * Capability Eval: Semantic Topic Clustering
 * 验证 SemanticClusterService 能否准确提取主题，对比 legacy 哈希聚类。
 */
describe.skipIf(!hasEvalLlmKeys())("Topic Clustering Capability Eval", () => {
  it("compares semantic extraction vs legacy splitting", async () => {
    const cases = [
      {
        id: "cluster-diverse-apple",
        title: "Diverse mentions of apples",
        input: "我不喜欢吃苹果。苹果太甜了。买点红富士吧。",
        expected: { primaryTopic: "苹果/饮食偏好", entities: ["苹果", "红富士"] },
      },
      {
        id: "cluster-vague-emotion",
        title: "Vague emotional signals",
        input: "我今天心情特别不好。感觉很沮丧。想找人聊天。",
        expected: { primaryTopic: "负面情绪/社交需求", entities: ["心情", "沮丧"] },
      },
    ];

    const llm = makeEvalLlm();
    const semanticService = new SemanticClusterService({ llm } as any);

    for (const evalCase of cases) {
      const start = Date.now();

      // Legacy Splitting (for comparison in report)
      const legacyKey =
        evalCase.input
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .slice(0, 2)
          .join("_") || "unknown";

      // New Semantic Extraction
      const result = await semanticService.extractFeatures(evalCase.input);

      const score = summarizeChecks([
        {
          ok: result.primaryTopic !== "unknown",
          name: "topic_identified",
          note: `Topic: ${result.primaryTopic}`,
        },
        {
          ok: result.entities.length > 0,
          name: "entities_extracted",
          note: `Entities: ${result.entities.map((e) => e.name).join(", ")}`,
        },
        {
          ok: result.normalizedKey.length > 3,
          name: "valid_key",
          note: `Key: ${result.normalizedKey}`,
        },
      ]);

      maybeAssertScore(score, 0.6);

      await recordEvalCase({
        suite: "topic_clustering",
        caseId: evalCase.id,
        title: evalCase.title,
        model: evalModelLabel(),
        latencyMs: Date.now() - start,
        input: { text: evalCase.input, legacyKey },
        output: result,
        score,
      });
    }
  }, 120000);
});
