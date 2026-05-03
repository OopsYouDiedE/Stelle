import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 包含所有 eval，包括 capabilities 和 infra
    include: ["evals/**/*.eval.ts"],
    // Eval 依赖真实 LLM 调用，可能需要较长时间
    testTimeout: 60000,
  },
});
