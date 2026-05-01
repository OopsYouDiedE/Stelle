import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  capability: z.string().min(1),
  source: z.enum(["synthetic", "curated_real", "regression", "adversarial", "canary"]),
  domain: z.enum(["discord", "live", "inner", "stage", "tool", "memory"]),
  input: z.record(z.unknown()),
  expected: z.record(z.unknown()),
  riskFlags: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export async function loadEvalCases(fileName: string): Promise<EvalCase[]> {
  const filePath = path.resolve("evals", "materials", "curated", fileName);
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => {
    try {
      return EvalCaseSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(
        `Invalid eval case in ${fileName}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
