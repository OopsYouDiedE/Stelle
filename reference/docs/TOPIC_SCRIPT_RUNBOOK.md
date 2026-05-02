# Topic Script Runbook

This runbook covers the production path for Stelle topic scripts.

## Preflight

Run the normal live preflight before opening the room:

```bash
npm run build
npm run live:preflight
```

Topic scripts are optional by default. If a show must use an approved script, set:

```bash
STELLE_TOPIC_SCRIPT_REQUIRED=true
```

With that flag, preflight fails when no approved compiled script exists or when any section has no fallback line.

## Operator Controls

Use the existing live control endpoint with `topic_script.*` actions:

```json
{ "action": "topic_script.snapshot" }
{ "action": "topic_script.approve", "scriptId": "ts_example", "revision": 1 }
{ "action": "topic_script.lock_section", "scriptId": "ts_example", "revision": 1, "sectionId": "opening_1" }
{ "action": "topic_script.load_latest" }
{ "action": "topic_script.pause" }
{ "action": "topic_script.resume" }
{ "action": "topic_script.skip_section", "reason": "operator_skip" }
{ "action": "topic_script.force_fallback", "reason": "operator_fallback" }
{ "action": "topic_script.archive", "scriptId": "ts_example", "revision": 1 }
```

Approved revisions are immutable. To change one, create a new draft revision, review it, then approve the new revision.

## Live Operation

- Keep the Stage Output panel visible during scripted shows.
- Direct viewer questions and challenges should interrupt the script as `direct_response`.
- Topic section hosting should appear as `topic_hosting`.
- If the script drifts into an unsafe area, use `topic_script.force_fallback`.
- If the operator needs full control, use the existing live control pause/queue controls and then `topic_script.pause`.

## Observability

Topic script output intents include:

- `script_id`
- `revision`
- `section_id`

Topic script runtime events include:

- `topic_script.section_started`
- `topic_script.section_completed`
- `topic_script.interrupted`
- `topic_script.fallback_used`

Use these IDs to trace:

```text
topic_script_runtime -> StageOutputArbiter -> stage.output.started/completed
```

## Failure Handling

- No approved script: runtime starts without scripted hosting unless `STELLE_TOPIC_SCRIPT_REQUIRED=true`.
- Missing compiled artifact: rerun approval for the target revision.
- Missing fallback lines: edit the draft, compile, approve a new revision.
- LLM generation failure: `TopicScriptService` returns a safe template draft instead of blocking live runtime.
- LLM revision failure: keep the current section and use fallback or manual operator output.
- Provider outage during live: avoid online patching; continue from approved compiled script and operator controls.

## Release Checklist

- `npm run test`
- `npm run build`
- `npm run live:preflight`
- `npm run test:eval -- topic_script_generation`
- `npm run test:eval -- topic_script_revision`
- `npm run test:eval -- topic_script_runtime_decision`
- `npm run test:eval -- topic_script_replay`
