const startedAt = new Date().toISOString();

export function currentEvalRunStartedAt(): string {
  return process.env.STELLE_EVAL_RUN_STARTED_AT || startedAt;
}
