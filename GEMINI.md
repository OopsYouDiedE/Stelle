# Stelle Project Mandates

## Internal Windows Architecture (v2)

All subjective decision-making in Stelle must follow the **Decision Cycle** pattern as defined in the "Internal Windows 设计稿 v2".

### 1. Causal Tracing
Every event and action must be traceable.
- **CycleId:** Identifies a single thought/decision loop.
- **CorrelationId:** Identifies the originating external trigger (e.g., a specific Discord message).
- **CausationId:** Points to the immediate preceding event.

### 2. State Watermarks
Components must declare the version of the world, memory, or reflection state they relied on.
- Always include `watermarks` in `EventEnvelope`.
- Never perform a cognitive decision without a `StateWatermark`.

### 3. Outbox Pattern
To ensure consistency between data and events:
- **Rule:** DataPlane/Store MUST be updated *before* the corresponding event is published.
- Use versioned snapshots or patches.

### 4. Intent Filtering (Hard Gates)
Cognition (LLM) generates **Candidate Intents**, but it does NOT decide if they are executable.
- **Interaction Policy** is the source of truth for affordances and permissions.
- Intents that fail hard gates (affordance unavailable, high risk, no permission) must be blocked before reaching the scoring phase.

### 5. Memory & Reflection
- **Memory Retention:** Use rule-based importance (e.g., explicit user requests, promises) rather than pure LLM scoring.
- **Reflection:** Must include an `evidenceMemoryIds` chain. Reflections without evidence are invalid.

## Technical Standards
- **Schemas:** All world entities must be validated against a registered schema. Use `src/capabilities/world_model/schema.ts` as the base.
- **Testing:** Integration tests must use deterministic mocks. Avoid real LLM calls in CI/CD.
- **Errors:** Favor explicit error results over throwing exceptions in the decision loop.
