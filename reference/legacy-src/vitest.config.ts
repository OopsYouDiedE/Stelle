import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["reference/legacy-src/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
