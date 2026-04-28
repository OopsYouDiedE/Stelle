import fs from "node:fs/promises";
import path from "node:path";
import type { EvalScore } from "./scoring.js";
import { currentEvalRunStartedAt } from "./run_context.js";
import { generateReadableEvalSummaryReport } from "./summary_report.js";

export interface EvalReportCase {
  suite: string;
  caseId: string;
  title: string;
  model: string;
  latencyMs: number;
  output: unknown;
  score: EvalScore;
}

export async function recordEvalCase(report: EvalReportCase): Promise<void> {
  const logDir = path.resolve("evals", "logs");
  await fs.mkdir(logDir, { recursive: true });

  const mdPath = path.join(logDir, `${report.suite}_report.md`);
  const jsonPath = path.join(logDir, `${report.suite}_summary.json`);
  const timestamp = new Date().toISOString();

  const output = truncate(sanitizeSecrets(JSON.stringify(report.output, null, 2)), 4000);
  const content = [
    `### ${report.suite}: ${report.caseId} @ ${timestamp}`,
    `- **Title**: ${report.title}`,
    `- **Model**: ${report.model}`,
    `- **Latency**: ${report.latencyMs}ms`,
    `- **Passed**: ${report.score.passed}`,
    `- **Score**: ${report.score.score.toFixed(2)}`,
    `- **Failed Checks**: ${report.score.failedChecks.length ? report.score.failedChecks.join(", ") : "none"}`,
    "",
    "#### Output",
    "```json",
    output,
    "```",
    "",
    "---",
    "",
  ].join("\n");
  await fs.appendFile(mdPath, content, "utf8");

  const summary = await readSummary(jsonPath);
  summary.runs.push({
    timestamp,
    runStartedAt: currentEvalRunStartedAt(),
    caseId: report.caseId,
    title: report.title,
    model: report.model,
    latencyMs: report.latencyMs,
    passed: report.score.passed,
    score: report.score.score,
    failedChecks: report.score.failedChecks,
    notes: report.score.notes,
  });
  await fs.writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await generateReadableEvalSummaryReport();
}

async function readSummary(filePath: string): Promise<{ runs: Array<Record<string, unknown>> }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { runs?: Array<Record<string, unknown>> };
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

function sanitizeSecrets(text: string): string {
  let out = text;
  for (const key of ["GEMINI_API_KEY", "DASHSCOPE_API_KEY", "OPENAI_API_KEY", "DISCORD_TOKEN"]) {
    const value = process.env[key];
    if (value) out = out.split(value).join(`[redacted:${key}]`);
  }
  return out
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]")
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted:google-key]");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}
