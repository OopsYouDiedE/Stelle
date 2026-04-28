# Stage Output Arbiter

## Purpose

`StageOutputArbiter` is the runtime service that controls access to Stelle's live stage output.

It exists because live-stage output is limited:
- only one TTS stream should speak at a time;
- the caption window is small;
- Live2D / VRM motion and expression should not be overwritten randomly;
- viewer attention is limited;
- multiple Cursors may want to output simultaneously.

Therefore, Cursors do not own live output. They submit `OutputIntent`.

The Arbiter decides whether the output is accepted, queued, merged, summarized, dropped, or interrupted.

## Concept Model

A Cursor is a domain-specific cognitive context window.

Examples:
- `DiscordCursor`: Discord social context window.
- `LiveCursor`: live-room context window.
- `InnerCursor`: self-state and reflection context window.

A Cursor may want to speak.

The Arbiter decides whether the stage can afford that speech.

The Stage is not a Cursor.  
The Arbiter is not a Cursor.  
The Renderer is not a Cursor.

The Stage is the shared output environment. The Arbiter controls access to that environment. The Renderer performs actual output.

## Output Flow

```text
Input Source
  -> Cursor
  -> OutputIntent
  -> StageOutputArbiter
  -> StageOutputRenderer
  -> ToolRegistry
  -> LiveRuntime / TTS / Renderer
```

Cursor-generated output must be treated as intention, not as an immediate side effect.

## OutputIntent

```ts
export type OutputLane =
  | "emergency"
  | "direct_response"
  | "topic_hosting"
  | "live_chat"
  | "ambient"
  | "inner_reaction"
  | "debug";

export interface OutputIntent {
  id: string;
  cursorId: string;
  sourceEventId?: string;

  lane: OutputLane;
  priority: number;
  salience: "low" | "medium" | "high" | "critical";

  text: string;
  summary?: string;
  topic?: string;
  mergeKey?: string;

  ttlMs: number;
  interrupt: "none" | "soft" | "hard";
  estimatedDurationMs?: number;

  output: {
    caption?: boolean;
    tts?: boolean;
    motion?: string;
    expression?: string;
    discordReply?: {
      channelId: string;
      messageId?: string;
    };
  };

  metadata?: Record<string, unknown>;
}
```

## Initial Arbitration Rules

Version 1 arbitration MUST be deterministic. Do not use LLM-based arbitration yet.

Priority order:

```text
emergency > direct_response > topic_hosting > live_chat > ambient > inner_reaction > debug
```

Rules:

1. `emergency` may hard-interrupt all lanes.
2. `direct_response` may soft-interrupt `ambient` and low-priority `live_chat`.
3. `topic_hosting` may output when the stage is free.
4. `live_chat` may output when the stage is free; queue length must be limited.
5. `ambient` may only output after a quiet interval.
6. `inner_reaction` is dropped by default or converted into policy overlay.
7. Expired intents must be dropped.
8. Repeated output from the same Cursor should receive a cooldown penalty.
9. Long output should be truncated or summarized according to lane budget.

## Event Semantics

`cursor.output.propose` is not a command to output immediately. It is a request for stage access.

Only `stage.output.started` means the output actually reached the stage.

Only `stage.output.completed` means it should be recorded as spoken live output.

Rejected or expired intentions may be recorded as internal observations, but they MUST NOT be written as spoken live history.

## Migration Plan

Phase 1:
- Add stage output types.
- Add Arbiter skeleton.
- Add Renderer skeleton.
- Do not modify existing Cursor behavior.

Phase 2:
- Wire `StageOutputArbiter` into `StelleApplication`.
- Add `stageOutput` to `CursorContext`.
- Add debug snapshot.

Phase 3:
- Migrate `LiveCursor` live output to `OutputIntent`.

Phase 4:
- Migrate Discord-to-live escalation.
- Discord internal replies may still use `DiscordResponder`.

Phase 5:
- Migrate Debug/System live output.

Phase 6:
- Restrict Cursor access to live external-write tools.
- Only `StageOutputRenderer` may call live output tools.
