import fs from "node:fs/promises";
import path from "node:path";
import { currentEvalRunStartedAt } from "./run_context.js";

interface SummaryRun {
  timestamp?: string;
  caseId?: string;
  title?: string;
  model?: string;
  latencyMs?: number;
  passed?: boolean;
  score?: number;
  failedChecks?: string[];
  notes?: string[];
}

interface SuiteSummary {
  suite: string;
  runs: SummaryRun[];
}

export async function generateReadableEvalSummaryReport(): Promise<void> {
  const logDir = path.resolve("evals", "logs");
  await fs.mkdir(logDir, { recursive: true });

  const runStartedAt = currentEvalRunStartedAt();
  const summaries = await loadCurrentRunSummaries(logDir, runStartedAt);
  const allRuns = summaries.flatMap(summary => summary.runs.map(run => ({ ...run, suite: summary.suite })));
  const model = firstString(allRuns.map(run => run.model)) || "unknown";
  const total = allRuns.length;
  const passed = allRuns.filter(run => run.passed).length;
  const failed = total - passed;
  const averageScore = total
    ? allRuns.reduce((sum, run) => sum + (typeof run.score === "number" ? run.score : 0), 0) / total
    : 0;
  const totalLatency = allRuns.reduce((sum, run) => sum + (typeof run.latencyMs === "number" ? run.latencyMs : 0), 0);

  const lines = [
    "# Stelle Eval Summary Report",
    "",
    `- Run started: ${runStartedAt}`,
    `- Report generated: ${new Date().toISOString()}`,
    `- Model: ${model}`,
    `- Cases: ${total}`,
    `- Passed: ${passed}`,
    `- Failed: ${failed}`,
    `- Average score: ${averageScore.toFixed(2)}`,
    `- Total model latency: ${totalLatency}ms`,
    "",
    "## Suite Overview",
    "",
    "| Suite | Cases | Passed | Failed | Avg Score | Avg Latency |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map(summary => formatSuiteRow(summary)),
    "",
    "## Attention Needed",
    "",
    ...formatFailures(allRuns),
    "",
    "## Notes",
    "",
    total === 0
      ? "- No eval cases were recorded in this run. This usually means model evals were skipped because API keys were unavailable or disabled."
      : "- Detailed per-suite reports remain in `evals/logs/*_report.md`.",
    "- This summary is generated from current-run JSON summaries, not from raw private material.",
    "",
  ];

  await fs.writeFile(path.join(logDir, "eval_summary_report.md"), `${lines.join("\n")}\n`, "utf8");
}

async function loadCurrentRunSummaries(logDir: string, runStartedAt: string): Promise<SuiteSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    return [];
  }

  const summaries: SuiteSummary[] = [];
  for (const entry of entries.filter(name => name.endsWith("_summary.json"))) {
    if (entry === "eval_summary.json") continue;
    const suite = entry.replace(/_summary\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(logDir, entry), "utf8");
      const parsed = JSON.parse(raw) as { runs?: SummaryRun[] };
      const runs = Array.isArray(parsed.runs)
        ? parsed.runs.filter(run => typeof run.timestamp === "string" && run.timestamp >= runStartedAt)
        : [];
      if (runs.length > 0) summaries.push({ suite, runs });
    } catch {
      // Ignore malformed historical summaries. Individual evals still own their detailed report.
    }
  }
  return summaries.sort((a, b) => a.suite.localeCompare(b.suite));
}

function formatSuiteRow(summary: SuiteSummary): string {
  const count = summary.runs.length;
  const passed = summary.runs.filter(run => run.passed).length;
  const failed = count - passed;
  const score = count ? summary.runs.reduce((sum, run) => sum + (run.score ?? 0), 0) / count : 0;
  const latency = count ? Math.round(summary.runs.reduce((sum, run) => sum + (run.latencyMs ?? 0), 0) / count) : 0;
  return `| ${summary.suite} | ${count} | ${passed} | ${failed} | ${score.toFixed(2)} | ${latency}ms |`;
}

function formatFailures(runs: Array<SummaryRun & { suite: string }>): string[] {
  const failures = runs.filter(run => !run.passed);
  if (failures.length === 0) return ["- No failed eval checks in this run."];

  return failures.flatMap(run => {
    const failedChecks = run.failedChecks?.length ? run.failedChecks.join(", ") : "unknown";
    const notes = run.notes?.length ? ` Notes: ${run.notes.slice(0, 3).join(" | ")}` : "";
    return [`- ${run.suite}/${run.caseId ?? "unknown"}: ${run.title ?? "Untitled"} (${failedChecks}).${notes}`];
  });
}

function firstString(values: Array<unknown>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
