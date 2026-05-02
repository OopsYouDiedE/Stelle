import fs from "node:fs/promises";
import path from "node:path";
import { currentEvalRunStartedAt } from "./run_context.js";

interface SummaryRun {
  timestamp?: string;
  caseId?: string;
  title?: string;
  model?: string;
  latencyMs?: number;
  reviewStatus?: string;
  inputPreview?: string;
  outputPreview?: string;
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
  const allRuns = summaries.flatMap((summary) => summary.runs.map((run) => ({ ...run, suite: summary.suite })));
  const model = firstString(allRuns.map((run) => run.model)) || "unknown";
  const total = allRuns.length;
  const autoCheckedRuns = allRuns.filter(
    (run) => run.reviewStatus === "auto_checked" || typeof run.passed === "boolean",
  );
  const manualReview = autoCheckedRuns.length === 0;
  const passed = autoCheckedRuns.filter((run) => run.passed).length;
  const failed = autoCheckedRuns.filter((run) => run.passed === false).length;
  const averageScore = autoCheckedRuns.length
    ? autoCheckedRuns.reduce((sum, run) => sum + (typeof run.score === "number" ? run.score : 0), 0) /
      autoCheckedRuns.length
    : 0;
  const totalLatency = allRuns.reduce((sum, run) => sum + (typeof run.latencyMs === "number" ? run.latencyMs : 0), 0);

  const lines = [
    "# Stelle Eval 总体报告",
    "",
    `- **运行开始**：${runStartedAt}`,
    `- **报告生成**：${new Date().toISOString()}`,
    `- **使用模型**：${model}`,
    `- **测试项目数**：${total}`,
    manualReview
      ? "- **判定方式**：人工审阅；代码只记录输入与输出，不给出通过/失败结论。"
      : "- **判定方式**：自动检查（显式开启）。",
    ...(manualReview
      ? []
      : [`- **通过**：${passed}`, `- **未通过**：${failed}`, `- **平均得分**：${averageScore.toFixed(2)}`]),
    `- **模型总耗时**：${totalLatency}ms`,
    "",
    "## 套件总览",
    "",
    manualReview ? "| 套件 | 记录数 | 平均耗时 |" : "| 套件 | 测试数 | 通过 | 未通过 | 平均得分 | 平均耗时 |",
    manualReview ? "| --- | ---: | ---: |" : "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...summaries.map((summary) => formatSuiteRow(summary, manualReview)),
    "",
    manualReview ? "## 人工审阅样例" : "## 需要关注的项目",
    "",
    ...(manualReview ? formatManualReviewSamples(allRuns) : formatFailures(allRuns)),
    "",
    "## 总体结论",
    "",
    total === 0
      ? "- 本次没有记录任何 eval 用例，通常表示缺少 API key 或 eval 被跳过。"
      : manualReview
        ? "- 本次 eval 已完成执行并记录输入/输出；请查看上方样例和 `evals/logs/*_report.md` 后进行人工判断。"
        : failed === 0
          ? "- 本次所有已记录 eval 均通过；详细的测试项目、使用数据、输出结果和结果评估见 `evals/logs/*_report.md`。"
          : "- 本次仍有未通过 eval；请优先查看上方“需要关注的项目”，再进入对应套件报告定位具体输入与输出。",
    "- 该总体报告由本次运行的 JSON 摘要生成；每个套件的可读报告会截断过长数据并过滤常见密钥。",
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
  for (const entry of entries.filter((name) => name.endsWith("_summary.json"))) {
    if (entry === "eval_summary.json") continue;
    const suite = entry.replace(/_summary\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(logDir, entry), "utf8");
      const parsed = JSON.parse(raw) as { runs?: SummaryRun[] };
      const runs = Array.isArray(parsed.runs)
        ? parsed.runs.filter((run) => typeof run.timestamp === "string" && run.timestamp >= runStartedAt)
        : [];
      if (runs.length > 0) summaries.push({ suite, runs });
    } catch {
      // Ignore malformed historical summaries. Individual evals still own their detailed report.
    }
  }
  return summaries.sort((a, b) => a.suite.localeCompare(b.suite));
}

function formatSuiteRow(summary: SuiteSummary, manualReview: boolean): string {
  const count = summary.runs.length;
  const latency = count ? Math.round(summary.runs.reduce((sum, run) => sum + (run.latencyMs ?? 0), 0) / count) : 0;
  if (manualReview) return `| ${summary.suite} | ${count} | ${latency}ms |`;
  const passed = summary.runs.filter((run) => run.passed).length;
  const failed = summary.runs.filter((run) => run.passed === false).length;
  const score = count ? summary.runs.reduce((sum, run) => sum + (run.score ?? 0), 0) / count : 0;
  return `| ${summary.suite} | ${count} | ${passed} | ${failed} | ${score.toFixed(2)} | ${latency}ms |`;
}

function formatFailures(runs: Array<SummaryRun & { suite: string }>): string[] {
  const failures = runs.filter((run) => run.passed === false);
  if (failures.length === 0) return ["- 本次没有失败检查。"];

  return failures.flatMap((run) => {
    const failedChecks = run.failedChecks?.length ? run.failedChecks.join("、") : "未知";
    const notes = run.notes?.length ? ` 说明：${run.notes.slice(0, 3).join(" | ")}` : "";
    return [
      `- ${run.suite}/${run.caseId ?? "unknown"}：${run.title ?? "未命名"}（失败检查：${failedChecks}）。${notes}`,
    ];
  });
}

function formatManualReviewSamples(runs: Array<SummaryRun & { suite: string }>): string[] {
  if (runs.length === 0) return ["- 本次没有可审阅样例。"];
  return runs
    .slice(0, 8)
    .flatMap((run) => [
      `### ${run.suite}/${run.caseId ?? "unknown"}：${run.title ?? "未命名"}`,
      "",
      "**输入**",
      "```json",
      truncatePreview(run.inputPreview ?? "未记录", 1200),
      "```",
      "",
      "**输出**",
      "```json",
      truncatePreview(run.outputPreview ?? "未记录", 1600),
      "```",
      "",
    ]);
}

function truncatePreview(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... [truncated]`;
}

function firstString(values: Array<unknown>): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}
