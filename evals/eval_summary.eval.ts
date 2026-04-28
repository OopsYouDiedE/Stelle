import { describe, it } from "vitest";
import { generateReadableEvalSummaryReport } from "./utils/summary_report.js";

describe("Eval Summary Report", () => {
  it("generates a readable run-level summary report", async () => {
    await generateReadableEvalSummaryReport();
  });
});
