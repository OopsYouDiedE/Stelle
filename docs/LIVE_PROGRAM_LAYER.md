# Live Program Layer

The Live Program Layer turns Stelle's live room into an AI topic host and dynamic information stage. It is intentionally not a public viewer-profile wall, an automatic personality-training system, or an OBS director.

## What It Shows

- TopicCompass: current topic, phase, current question, and next question.
- ChatCluster: anonymous counts and low-sensitive representative text.
- ConclusionBoard: up to three short public conclusions.
- QuestionQueue: deduplicated questions to answer later.
- PublicMemoryWall: public, low-sensitive program memories only.
- WorldCanon: proposed/confirmed/rejected/archived worldbuilding entries.
- PromptLab: sandboxed prompt experiments that do not affect the main persona.
- AnonymousCommunityMap: aggregate heat by participation type and cluster.
- StageStatus: real stage, queue, audio, and health status.

## Safety Boundaries

Do not expose:

- personal viewer relationship graphs;
- viewer IDs, private history, long-term preferences, or relationship stage;
- full chain-of-thought, raw prompts, system prompts, or raw memory retrievals;
- automatic core identity updates from danmaku;
- paid events directly changing canon or personality;
- fake emotion percentages or fake attention ratios;
- OBS start/stop or scene automation.

Political/current-affairs, privacy, prompt-injection, sexual, abusive, and minor-safety risks are filtered before they enter public program widgets.

## Program Templates

The built-in templates are:

- Human Behavior Observation: behavior summaries without psychological diagnosis.
- Danmaku Court: safe value debates, excluding politics, medical, legal, financial, and personal moral judgment topics.
- Prompt Lab: sandboxed answer-style experiments.
- Memory Recall Night: public episode memory only.
- Worldbuilding: new canon starts as proposals.
- Viewer Diagnosis: learning, creative, project, stream planning, and goal decomposition only.
- AI Reflection: behavior-strategy review, not claims of consciousness.

## Runtime Flow

```text
live.event.received
  -> TopicOrchestrator
  -> live.program.updated
  -> LiveRuntime widget commands
  -> renderer widgets
```

Speech remains sparse:

- ordinary clustering updates only the UI;
- phase transitions and key summaries may submit a low-priority `topic_hosting` OutputIntent;
- StageOutputArbiter remains the only spoken stage path.

## Episode Summary

After a session, generate a public-safe summary:

```bash
npm run live:episode-summary
```

To also write a public room memory:

```bash
npm run live:episode-summary -- --write-public-memory
```

The summary is written to:

```text
artifacts/live-sessions/<sessionId>/episode_summary.json
```
