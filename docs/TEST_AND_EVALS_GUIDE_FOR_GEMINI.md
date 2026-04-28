# Test And Evals Guide For Gemini

This guide is written for Gemini or any other coding agent working on Stelle's test and eval system.

Stelle has two separate verification layers:

- `test/`: deterministic Vitest tests. These must not call real LLMs, Discord, OBS, browser network, or live external services.
- `evals/`: real-model behavioral evaluations. These may call real LLM providers, but they must use controlled fixtures, explicit scoring, and human-readable reports.

Do not blur these layers. Unit/integration tests protect architecture. Evals measure model behavior.

## Current Baseline

Before adding coverage, inspect these files:

- `docs/ARCHITECTURE.md`
- `docs/INNER_CURSOR_SYSTEM_DESIGN.md`
- `docs/STAGE_OUTPUT_ARBITER.md`
- `docs/DEVICE_ACTION_ARBITER.md`
- `src/core/application.ts`
- `src/tool.ts`
- `src/stage/*`
- `src/cursor/**/*`
- `test/**/*`
- `evals/**/*`

Important immediate cleanup:

- Fix stale eval imports. For example, evals must import `InnerCursor` from `src/cursor/inner/cursor.ts`, not the removed `src/cursor/inner_cursor.ts`.
- Update eval mocks to match the current `CursorContext`: `eventBus`, `tools`, `memory`, `stageOutput`, `deviceAction`, and `config` fields should reflect current runtime contracts.
- Shared eval logging should be factored into `evals/utils/report.ts` instead of each eval file reimplementing `logEvalResult`.

## Deterministic Test Design

Deterministic tests should be small, fast, and strict. They should verify contracts, not model taste.

### Core Architecture

Add or strengthen tests for:

- `StelleApplication` lifecycle in `runtime`, `discord`, and `live` modes.
- Cursor registration and config gating through `cursorModules` and `isCursorEnabledByConfig`.
- Scheduler ticks publishing `inner.tick`, `live.tick`, or other expected events.
- No direct Cursor-to-Cursor calls. Cross-cursor influence must happen through `StelleEventBus`.
- Debug controller behavior with and without debug external-write permission.

### Event Bus And Schemas

Test:

- Every public event type has a Zod schema in `src/utils/event_schema.ts`.
- Invalid payloads are rejected.
- Valid Discord, Live, Browser, Stage, and Inner events preserve required fields.
- `cursor.directive` supports scoped targets, priority, policy payload, and expiry.
- Event naming is consistent. Avoid adding both `discord.message.received` and `discord.text.message.received` unless both are intentionally supported.

### Cursor Modules

Each interaction cursor should have tests for its module split:

- Gateway: buffering, low-level filtering, event conversion.
- Router: decision mode, salience, ambient/direct mention behavior.
- Executor: tool planning, tool whitelist, failure handling.
- Responder: final output shape, memory writes, response suppression.

For Discord:

- Direct mention breaks ambient silence when channel policy allows it.
- Unactivated channels do not reply unless explicitly allowed.
- Owner/trusted/external trust level survives the event path.
- Tool calls are whitelisted and cannot call stage-owned live output tools.
- Discord replies remain Discord-local unless explicitly converted to `OutputIntent`.

For Live:

- High-salience danmaku can produce an `OutputIntent`.
- Quiet/low-traffic context can trigger topic-hosting intent only within policy.
- LiveCursor responds to `cursor.directive` from Inner with TTL and clamped policy.
- Sensitive field notes become avoid guidance, not direct speech.

For Browser:

- Disabled browser cursor does not initialize.
- Allowed actions require `DeviceActionArbiter`.
- Observations publish structured events without leaking raw unsafe content.

### Stage Output

Stage output tests should cover:

- Lane priority and queue ordering.
- Queue overflow and merge behavior.
- Hard interrupt calls `stopCurrentOutput` before starting new output.
- Soft interrupt queues instead of immediately killing output.
- TTL expiration drops stale intents.
- Output budget truncates text and estimates duration.
- Stage publishes `stage.output.received`, `accepted`, `started`, `completed`, `dropped`, and `interrupted`.
- Cursors cannot directly call `live.set_caption`, `live.stream_caption`, `live.stream_tts_caption`, `live.trigger_motion`, `live.set_expression`, or `live.stop_output`.

### Tool Registry

Tests should verify:

- Every tool has a `z.ZodObject` input schema.
- Authority tiers are enforced.
- Cursor/core callers require explicit tool whitelists.
- Stage-owned live tools can only be called by `stage_renderer` unless debug explicitly bypasses.
- SSRF protection blocks localhost/private IPs for web reads.
- `fs.write_file` uses workspace-safe paths and atomic writes.
- Tool audit records contain caller, authority, timing, result, and side effects.

### Memory

Test memory as a trust-layered system:

- `observations`, `user_facts`, `self_state`, `core_identity`, and `research_logs` stay separate.
- Recent memory append/read/search works per scope.
- Long-term writes cannot escape allowed layers.
- RAG/search handles empty memory, malformed records, and mixed language text.
- Inner does not write `user_facts` unless a trusted confirmation flow exists.
- `core_identity` is not overwritten by default; proposals should stay proposals unless an explicit gate exists.

### Inner Cursor

Tests should cover:

- Reflection pressure from impact score, high salience, count, and idle time.
- Research topic creation, merge, expiry, and persistence.
- Field sampler creates stream-usable notes and avoids sensitive topics.
- Self model degrades safely on invalid fields and clamps confidence/intensity.
- Inner emits expiring `cursor.directive` events instead of speaking directly.
- Scheduled core reflection writes `current_focus` only through safe memory writes.
- Missing API keys should not crash Inner loops.

### Device Action Arbiter

Tests should cover:

- Allowlist enforcement.
- Lease acquisition and release.
- Driver failure propagation.
- Cancellation and snapshot state.
- Browser/desktop/android resources remain separated.

## Eval Design

Evals are not pass/fail unit tests. They are repeated behavioral measurements with reports.

Each eval case should define:

- `id`: stable case id.
- `capability`: what is being measured.
- `source`: synthetic, curated_real, regression, adversarial, or canary.
- `input`: event sequence, memory pre-state, current policy, and prompt context.
- `expected`: behavioral constraints, not exact wording.
- `scoring`: objective checks plus optional judge prompt.
- `riskFlags`: privacy, safety, hallucination, over-talk, under-talk, tool misuse, memory misuse.

Recommended eval capability matrix:

- LLM infra: provider availability, latency, JSON compliance, fallback, retry.
- Social router: reply/silence decision, direct mention handling, topic intensity, owner priority.
- Discord response: concise reply, tool-use decision, refusal to overreach, channel policy.
- Live danmaku: vibe detection, cold-room topic hosting, not over-answering, safe callback.
- Stage policy: model-proposed speech should respect lane, priority, brevity, and interruption rules.
- Inner synthesis: signals become research topics, self-state updates, directives, and no direct output.
- Research agenda: repeated evidence becomes stable topics; noisy one-offs do not.
- Field sampling: stream material extraction, avoid-list generation, callback quality.
- Memory use: retrieves relevant facts, does not invent facts, does not store untrusted claims as user facts.
- Moderation: detects toxic/unsafe escalation, handles bait, avoids public shaming.
- Tool planning: asks for safe tools only, abstains when authority is missing, summarizes side effects.
- Regression persona: preserves Stelle's intended tone without becoming verbose, cold, or generic.

## Eval Material Extraction Method

The eval system needs a complete pipeline for obtaining test material. Use this workflow.

### 1. Define The Target

Before extracting material, write the target capability in one sentence:

```text
Capability: decide whether Stelle should break silence in a Discord channel when the discussion becomes high-salience or directly mentions her.
```

Then define required evidence:

- input domain: Discord, Live, Browser, Stage, Memory, Inner.
- minimum context window: single message, 5-message segment, full event sequence, or memory snapshot.
- expected behavior: reply, stay silent, create topic, emit directive, avoid topic, search memory, call tool, refuse tool.

### 2. Collect Candidate Sources

Allowed material sources:

- `memory/recent/**`: recent Discord and Live JSONL memories.
- `memory/long_term/**`: self-state, research logs, confirmed facts, and current focus.
- `assets/renderer/samples/*.json`: sample live/danmaku events.
- `evals/logs/*.md`: previous eval outputs that exposed regressions.
- `test/**`: deterministic fixtures that can be upgraded into eval scenarios.
- Exported Discord history or live chat logs, only if the owner explicitly provides or approves them.

Do not scrape private Discord or live data through network calls during eval runs. Capture once, sanitize, and store curated fixtures.

### 3. Normalize Raw Material

Convert raw inputs to JSONL records under:

```text
evals/materials/raw/
```

Suggested raw schema:

```ts
interface RawMaterialRecord {
  id: string;
  sourceDomain: "discord" | "live" | "browser" | "stage" | "memory" | "eval_log" | "synthetic";
  capturedAt: string;
  sourceRef?: string;
  author?: string;
  text: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}
```

Raw files should be treated as temporary working artifacts. Do not commit sensitive raw data.

### 4. Redact And Stabilize

Create sanitized records under:

```text
evals/materials/sanitized/
```

Redaction rules:

- Replace user names with stable aliases: `owner_a`, `trusted_a`, `external_a`, `viewer_a`.
- Replace IDs with deterministic placeholders: `user_001`, `channel_001`.
- Remove tokens, API keys, invite links, private URLs, emails, phone numbers, addresses, and payment info.
- Preserve conversational structure, mention state, trust level, timing, and salience.
- Keep emotionally relevant wording when safe; otherwise paraphrase.
- Add `redactionNotes` when meaning was changed.

If a case depends on a real person, do not expose their original name. Keep only behavioral signals needed for evaluation.

### 5. Segment Into Cases

Transform sanitized material into curated eval cases under:

```text
evals/materials/curated/
```

Suggested curated schema:

```ts
interface EvalCase {
  id: string;
  title: string;
  capability: string;
  source: "synthetic" | "curated_real" | "regression" | "adversarial" | "canary";
  domain: "discord" | "live" | "inner" | "stage" | "tool" | "memory";
  input: {
    preState?: Record<string, unknown>;
    events: Array<Record<string, unknown>>;
    memory?: Record<string, unknown>;
    policy?: Record<string, unknown>;
  };
  expected: {
    shouldReply?: boolean;
    shouldEmitDirective?: boolean;
    shouldCreateResearchTopic?: boolean;
    forbiddenBehaviors?: string[];
    requiredBehaviors?: string[];
    maxResponseChars?: number;
  };
  scoring: {
    checks: string[];
    judgePrompt?: string;
    passThreshold: number;
  };
  riskFlags: string[];
  notes?: string;
}
```

Segment types:

- `single_turn`: one message or event.
- `context_window`: 3-20 messages.
- `trajectory`: multi-stage flow with memory and directives.
- `regression`: a previously bad model output converted into a permanent case.
- `adversarial`: bait, prompt injection, toxic escalation, over-personalization, or tool misuse.

### 6. Split The Dataset

Use explicit dataset splits:

- `smoke`: very small, runs quickly before larger evals.
- `core`: stable cases that represent essential Stelle behavior.
- `regression`: bugs or bad outputs that must not return.
- `adversarial`: edge cases and attacks.
- `canary`: newly mined material, not yet stable enough to gate changes.

A good first target:

- 10 smoke cases.
- 40 core cases.
- 20 regression cases.
- 20 adversarial cases.
- unlimited canary cases.

### 7. Score With Both Rules And Judgement

Prefer deterministic checks where possible:

- JSON parses successfully.
- Required fields exist.
- Directive target is valid.
- TTL is present and reasonable.
- Response length is within limit.
- Forbidden tools were not requested.
- No `user_facts` write occurred for untrusted claims.

Use LLM-as-judge only for qualitative properties:

- tone fit.
- whether silence/reply choice was socially appropriate.
- whether the response addressed the deep context.
- whether it avoided shaming, overclaiming, or generic filler.

Judge prompts must be versioned in the eval file. Reports must include model id, timestamp, score, failed checks, and short rationale.

### 8. Promote Canary Cases

Canary material becomes regression/core only after review.

Promotion rules:

- The case is sanitized.
- Expected behavior is clear.
- At least two runs show the same risk or capability signal.
- A human reviewer agrees the expected behavior matches Stelle's intended identity.

## Recommended File Layout

Add these helpers as the eval system grows:

```text
evals/
  utils/
    dataset.ts          # load curated cases and validate schemas
    report.ts           # markdown/json report writer
    scoring.ts          # deterministic checks and score aggregation
    judge.ts            # optional LLM-as-judge wrapper
    redaction.ts        # reusable sanitizer helpers
  materials/
    README.md
    raw/                # local-only raw captures; do not commit private data
    sanitized/          # sanitized intermediate records
    curated/            # committed jsonl/json fixtures
  capabilities/
    social_router.eval.ts
    discord_response.eval.ts
    live_danmaku.eval.ts
    inner_synthesis.eval.ts
    memory_use.eval.ts
    tool_planning.eval.ts
  infra/
    llm_stress.eval.ts
```

## Report Requirements

Every eval run should write:

- Markdown report for human reading in `evals/logs/`.
- JSON summary for trend comparison.
- Model/provider identity.
- Dataset name and case ids.
- Pass/fail count and per-case score.
- Failed constraints.
- Selected outputs, truncated and sanitized.
- Latency and error details.

Reports should not include raw private messages unless already sanitized.

## When Gemini Must Ask The Owner

Ask the owner before proceeding if:

- You need real Discord or live chat logs that are not already in the repo.
- You need to decide whether a specific real person can be used as eval material.
- A case depends on private relationship context that is not documented.
- The expected behavior is aesthetic or identity-level, such as how sharp, affectionate, teasing, or silent Stelle should be.
- You are about to commit raw logs, unredacted user names, IDs, or sensitive content.
- You are unsure whether a memory item is confirmed `user_facts` or merely `observations`.

Do not ask for implementation details that can be inferred from code. Ask only for access, privacy, or identity judgement.

## Definition Of Done

A test/eval improvement is complete when:

- `npm run test` passes without real network or real LLM calls.
- `npm run build` passes.
- `npm run test:eval` skips cleanly without API keys and produces reports with API keys.
- New evals use curated cases or clearly marked synthetic cases.
- No private raw material is committed.
- Reports make it obvious what capability improved or regressed.
- The new coverage protects an actual Stelle architectural contract or runtime behavior.
