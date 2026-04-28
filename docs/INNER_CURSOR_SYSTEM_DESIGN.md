# Inner Cursor System Design

This document defines the target design for Stelle's Inner Cursor as a real cognitive subsystem. Inner is not a chat agent and not a developer proxy. It owns attention, research agendas, field sampling, and self-model maintenance. External LLMs and tools are replaceable engines underneath it.

## Design Position

Inner is the private cognitive loop of Stelle.

It should:
- observe cross-cursor events and memory;
- detect reflection pressure;
- set research topics;
- collect live-field material;
- maintain self-state and identity guardrails;
- emit structured `cursor.directive` events to other cursors.

It should not:
- directly speak to Discord or Live;
- directly call stage-owned live output tools;
- outsource runtime identity to Codex, Gemini CLI, or any coding agent;
- rewrite `core_identity` without explicit high-confidence gates.

Runtime rule:

```text
Inner owns cognition.
LLM/search/memory are tools.
Codex/Gemini CLI are development workers, not runtime organs.
```

## Target File Layout

```text
src/cursor/inner/
├─ cursor.ts              # Orchestrator, StelleCursor implementation
├─ observer.ts            # EventBus and memory signal aggregation
├─ pressure.ts            # Reflection pressure scoring
├─ research_agenda.ts     # Research topic lifecycle
├─ field_sampler.ts       # Live topic sampling and stream material
├─ self_model.ts          # Mood, focus, convictions, identity gates
├─ directive_planner.ts   # cursor.directive generation
├─ memory_writer.ts       # Layered memory writes and research logs
└─ types.ts               # Inner-specific contracts
```

Phase 1 structural migration has placed the Inner Cursor orchestrator at `src/cursor/inner/cursor.ts`. Existing behavior is preserved while introducing the modular layout.

## Core Concepts

### Cognitive Signal

Every meaningful input to Inner is normalized into a `CognitiveSignal`.

```ts
interface CognitiveSignal {
  id: string;
  source: "discord_text_channel" | "live_danmaku" | "stage_output" | "browser" | "system";
  kind: string;
  summary: string;
  timestamp: number;
  impactScore: number;
  salience: "low" | "medium" | "high";
  evidence?: Array<{ source: string; excerpt: string; timestamp?: number }>;
  metadata?: Record<string, unknown>;
}
```

Sources include:
- `cursor.reflection`;
- `stage.output.*`;
- `browser.observation.received`;
- recent memory from Discord and Live;
- tool audit summaries exposed through debug/runtime snapshots later.

### Research Topic

Inner maintains explicit research topics instead of only producing loose reflections.

```ts
interface ResearchTopic {
  id: string;
  title: string;
  subjectKind: "person" | "community" | "theme" | "relationship" | "self" | "stream";
  status: "active" | "cooling" | "closed";
  priority: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  evidence: ResearchEvidence[];
  openQuestions: string[];
  provisionalFindings: string[];
  nextActions: ResearchAction[];
}
```

Topic examples:
- "Why the live chat keeps returning to AI selfhood"
- "Owner's preference for low-interruption Discord replies"
- "Recurring tension between playful teasing and factual answering"
- "Stelle's current tendency to over-explain after tool use"

### Field Note

Live-field sampling converts observations into stream-useful material without forcing speech.

```ts
interface FieldNote {
  id: string;
  topicId?: string;
  source: "live" | "discord" | "memory" | "browser" | "system";
  excerpt: string;
  streamUse: "cold_open" | "callback" | "bridge_topic" | "avoid" | "question";
  vibe: "quiet" | "curious" | "playful" | "tense" | "technical" | "emotional";
  safety: "safe" | "sensitive" | "avoid";
  createdAt: number;
}
```

Field notes are material for LiveCursor, not direct speech.

### Self Model

Inner owns a layered self model.

```ts
interface SelfModelSnapshot {
  mood: string;
  currentFocus: string;
  activeConvictions: Array<{ topic: string; stance: string; confidence: number }>;
  behavioralWarnings: string[];
  styleBias: {
    replyBias?: "aggressive" | "normal" | "selective" | "silent";
    vibeIntensity?: number;
    preferredTempo?: "slow" | "normal" | "quick";
  };
}
```

Memory layers:
- `research_logs`: reasoning traces and topic updates;
- `self_state`: current focus, mood, active convictions, active research agenda;
- `core_identity`: rare durable identity changes only after repeated corroboration;
- `user_facts`: never written by Inner unless user-confirmed through trusted flow.

## Runtime Loops

### 1. Observation Loop

`InnerObserver` subscribes to:
- `cursor.reflection`;
- `stage.output.completed`;
- `stage.output.dropped`;
- `browser.observation.received`;
- `inner.tick`.

It also periodically reads:
- recent Discord global memory;
- recent Live memory;
- latest research logs;
- current `self_state/current_focus`.

Output: normalized `CognitiveSignal[]`.

### 2. Reflection Pressure Loop

`ReflectionPressureValve` determines when Inner should think.

Pressure dimensions:
- impact score;
- salience;
- novelty against active topics;
- repeated unresolved open questions;
- contradiction with current self model;
- elapsed time since last reflection;
- live-stage opportunity, such as quiet stream periods.

Suggested threshold:

```text
pressure =
  impactSum
  + highSalienceCount * 8
  + noveltyScore * 5
  + unresolvedTopicScore * 3
  + selfContradictionScore * 10
```

Trigger modes:
- `quick`: update field notes or directive only;
- `research`: update agenda and research logs;
- `core`: update self model and current focus;
- `identity_review`: propose, but do not automatically commit, core identity changes.

### 3. Research Agenda Loop

`ResearchAgenda` handles topic lifecycle.

Responsibilities:
- create new topics from repeated or high-salience signals;
- merge duplicate topics;
- attach evidence;
- maintain open questions;
- lower priority when stale;
- close topics with conclusions;
- write research logs.

Creation gates:
- at least one high-salience signal, or
- three related medium-salience signals, or
- explicit owner/system directive, or
- a self-contradiction event.

Closure gates:
- enough evidence to form a stable finding;
- topic has expired with no new evidence;
- topic is superseded by a broader topic.

### 4. Live Field Sampling Loop

`FieldSampler` converts research and recent observations into stream material.

Inputs:
- active research topics;
- Live recent memory;
- Discord global recent memory;
- stage output state;
- current self model.

Outputs:
- field notes;
- recommended live focus;
- avoid-list for sensitive or stale topics.

It emits `cursor.directive` to `live_danmaku`, for example:

```ts
{
  type: "cursor.directive",
  source: "inner",
  payload: {
    target: "live_danmaku",
    action: "apply_policy",
    policy: {
      focusTopic: "观众最近在反复讨论 AI 是否有自己的审美",
      replyBias: "selective",
      vibeIntensity: 3,
      instruction: "优先接住相关弹幕，用短句延展，不要主动长篇解释。"
    },
    priority: 2,
    expiresAt: now + 30 * 60_000
  }
}
```

### 5. Self Model Loop

`SelfModel` updates current self-state.

It should answer:
- What is Stelle currently paying attention to?
- Which behavior is becoming habitual?
- Is the current behavior aligned with core identity?
- What should be encouraged or dampened?

Writes:
- `self_state/current_focus`;
- `self_state/global_subconscious`;
- `self_state/core_convictions`;
- research log entries explaining why.

It may propose `core_identity` changes, but default implementation should store them as proposals or research findings, not directly overwrite `core_identity`.

## Module Contracts

### InnerCursor

Orchestrates all modules and implements `StelleCursor`.

```ts
class InnerCursor implements StelleCursor {
  initialize(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): CursorSnapshot;
}
```

It owns:
- subscription lifecycle;
- scheduled tick handling;
- module coordination;
- in-flight reflection locking.

It does not own prompt details beyond routing.

### InnerObserver

```ts
interface InnerObserver {
  recordEvent(event: StelleEvent): void;
  collectRecentSignals(limit?: number): Promise<CognitiveSignal[]>;
  snapshot(): Record<string, unknown>;
}
```

### ReflectionPressureValve

```ts
interface ReflectionPressureValve {
  record(signal: CognitiveSignal): void;
  evaluate(now: number): ReflectionDecision;
  reset(mode: ReflectionMode): void;
}
```

### ResearchAgenda

```ts
interface ResearchAgenda {
  update(signals: CognitiveSignal[], self: SelfModelSnapshot, now?: number): Promise<ResearchAgendaUpdate>;
  activeTopics(): ResearchTopic[];
  snapshot(): Record<string, unknown>;
  hydrate(topics: ResearchTopic[]): void;
}
```

### FieldSampler

```ts
interface FieldSampler {
  sample(input: FieldSamplingInput): Promise<FieldSamplingResult>;
}
```

### SelfModel

```ts
interface SelfModel {
  load(): Promise<SelfModelSnapshot>;
  update(input: SelfModelUpdateInput): Promise<SelfModelUpdate>;
  snapshot(): SelfModelSnapshot;
}
```

### DirectivePlanner

```ts
interface DirectivePlanner {
  plan(input: DirectivePlanningInput): CursorDirectiveEnvelope[];
}
```

### InnerMemoryWriter

All writes go through one module to preserve layer rules.

```ts
interface InnerMemoryWriter {
  writeResearchLog(update: ResearchAgendaUpdate | SelfModelUpdate): Promise<void>;
  writeSelfState(key: string, value: string): Promise<void>;
  proposeIdentityChange(proposal: IdentityProposal): Promise<void>;
}
```

## LLM Use

Inner should use LLM calls for synthesis, not for ownership.

Recommended calls:
- `research_agenda_update`: structured JSON, primary model for high pressure, secondary for routine;
- `field_sampling`: concise JSON, secondary model;
- `self_model_update`: structured JSON, primary only when pressure is high or scheduled core reflection;
- `directive_plan`: can be deterministic from agenda/self model when possible.

LLM outputs must be normalized with `asRecord`, `enumValue`, `clamp`, and Zod where practical.

No chain-of-thought should be stored. Research logs should store concise process summaries, evidence, and conclusions.

## Event Extensions

Existing events are enough for a first implementation:
- `cursor.reflection`;
- `cursor.directive`;
- `stage.output.*`;
- `browser.observation.received`;
- `inner.tick`.

Optional later events:
- `inner.research.topic.created`;
- `inner.research.topic.updated`;
- `inner.field_note.created`;
- `inner.self_model.updated`.

These should only be added when another runtime component needs to subscribe to them.

## Persistence

Suggested files under memory:

```text
memory/long_term/self_state/current_focus.md
memory/long_term/self_state/global_subconscious.md
memory/long_term/self_state/core_convictions.md
memory/long_term/self_state/research_agenda.md
memory/long_term/self_state/field_notes.md
memory/long_term/research_logs/index.md
```

`research_agenda.md` and `field_notes.md` may contain JSON fenced blocks or plain Markdown tables, but implementation should parse with structured helpers rather than fragile line splitting if structured read/write is needed.

## Safety And Governance

Hard rules:
- Inner cannot directly call live stage output tools.
- Inner writes `self_state` through `ToolRegistry` with `safe_write`.
- Inner does not write `user_facts` unless a trusted user confirmation flow exists.
- Inner does not overwrite `core_identity` by default.
- Inner directives must expire.
- Inner directives should be biasing, not absolute mind control.

Directive constraints:
- `replyBias: silent` should have short TTL unless explicitly owner/system requested.
- `vibeIntensity` should be clamped 1-5.
- `focusTopic` should be concise enough for prompts.
- sensitive topics should become `avoid` field notes, not active focus directives.

## Implementation Phases

### Phase 1: Structural Migration (Complete)

- [x] Move `src/cursor/inner_cursor.ts` to `src/cursor/inner/cursor.ts`.
- [x] Add empty but typed modules listed in target layout.
- [x] Keep existing behavior passing tests.
- [x] Update manifests/tests/docs.

Structural migration is complete. Existing behavior is preserved within the new modular layout.

### Phase 2: Research Agenda (Complete)

- [x] Implement `ResearchAgenda`;
- [x] persist active topics;
- [x] append research logs for topic creation/update/closure;
- [x] add tests for topic creation, merging, and expiry.

Acceptance:
- high-salience repeated signals create active topics;
- stale topics cool or close;
- no direct stage output.

### Phase 3: Field Sampling (Complete)

- [x] Implement `FieldSampler`;
- [x] generate field notes from Live/Discord recent memory;
- [x] emit `live_danmaku` directives with `focusTopic`, `replyBias`, `vibeIntensity`, and instruction.

Acceptance:
- quiet live context can produce topic guidance;
- sensitive topic produces avoid note, not focus directive.

### Phase 4: Self Model (Complete)

- [x] Implement `SelfModel`;
- [x] update current focus and global subconscious;
- [x] store active convictions with confidence;
- [x] write research logs explaining self-state updates.

Acceptance:
- self-state updates are evidence-backed;
- missing/invalid LLM fields degrade safely;
- core identity changes are proposals only.

### Phase 5: Optional Long-Running Research Worker

Only after the internal loop works, add a generic interface:

```ts
interface ResearchWorker {
  run(task: ResearchWorkerTask): Promise<ResearchWorkerResult>;
}
```

This worker may use a normal LLM provider, search tools, or a future external process. It must not be specifically coupled to Codex or Gemini CLI, and it must not own identity decisions.

## Test Plan

Unit tests:
- pressure threshold calculations;
- research topic create/merge/expire;
- field note safety classification;
- self model update normalization;
- directive TTL and target validation;
- memory writer layer enforcement.

Integration tests:
- `cursor.reflection` signals trigger agenda update;
- high pressure emits `cursor.directive`;
- `inner.tick` scheduled reflection updates `current_focus`;
- invalid LLM JSON falls back without throwing;
- no live output tools are called by Inner.

Regression tests:
- legacy `cursor.reflection` flow still works;
- existing `inner_cursor.test.ts` behavior preserved after migration;
- full `npm run test` and `npm run build`.

## Success Criteria

Inner is considered complete when:
- it can name what it is researching and why;
- it can turn stream observations into usable but non-forcing live guidance;
- it can update self-state with evidence and restraint;
- it can influence Discord/Live through expiring directives;
- it remains private, typed, testable, and not a direct output channel.
