# Stelle V2 Architecture Standards

This document defines the hard architectural constraints for Stelle. All development (human or AI) must adhere to these rules to maintain system integrity.

## 1. Modular Cursor Pattern (SRP)
Cursors MUST NOT become monolithic "god objects". A Cursor should act as an **Orchestrator** over decomposed sub-modules:
- **Gateway**: Physical I/O, event buffering, and low-level filtering (e.g., Discord API, Socket.io).
- **Router**: Logic & Decision making. Transforms incoming events into internal intentions or tool calls.
- **Executor**: Tool handling. Manages sequence and parallel execution of capabilities.
- **Responder**: Expression & State updating. Formulates the final output for the user.

*Example: See `src/cursor/discord/` for the reference implementation.*

## 2. Event-Driven Communication
- **Direct Calls Forbidden**: Cursors must not call methods on other Cursors. Communication is strictly via the `StelleEventBus`.
- **Event Schema**: All events MUST be defined in `src/utils/event_schema.ts` using Zod.
- **Directives**: Cognitive control from `InnerCursor` to other Cursors MUST use `cursor.directive` events with targets: `discord`, `live`, or `global`.

## 3. Tool Security & Validation
- **Zod Enforcement**: Every tool `inputSchema` MUST be a `z.ZodObject`. No manual parsing allowed in `execute()`.
- **Authority Tiers**:
    - `readonly`: No side effects.
    - `network_read`: Outbound requests (requires SSRF protection).
    - `safe_write`: Local workspace modifications.
    - `external_write`: User-visible side effects (Discord messages, Live captions).
    - `system`: Full shell/process access.
- **SSRF Protection**: Any tool performing HTTP requests MUST use `validatePublicHttpUrl` to block private IP ranges.

## 4. Layered Credibility Memory
Memory is partitioned into layers. Do not mix raw data with verified facts.
- `observations`: Raw logs, recent chat history. Unverified.
- `user_facts`: Information confirmed by the owner/trusted users.
- `self_state`: Internal ego state, moods, and active convictions.
- `core_identity`: Hard-coded or long-term behavioral baselines.
- `research_logs`: Periodic reflection outputs from `InnerCursor`.

*Rule: Writing to `user_facts` or `self_state` requires `safe_write` authority.*

## 5. Coding Standards
- **Strict Typing**: No `any` unless absolutely necessary for generic transformation. Use `asRecord` or `asString` helpers for unknown JSON.
- **Graceful Degradation**: LLM calls MUST implement the structure-aware fallback (Primary -> Secondary -> Fallback).
- **Atomic Writes**: All file system modifications MUST use `atomicWrite` to prevent corruption during crashes.
