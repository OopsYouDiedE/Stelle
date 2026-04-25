# Discord Data Collection

## Scope

- Channel ID: `1235845356697288747`
- Window: last 24 hours
- Collected at: `2026-04-24T14:39:45.506Z`
- Total messages collected: `1048`
- Unique authors: `24`

## Access And Handling

- Collection used the configured `DISCORD_TOKEN` already present in the local environment.
- Messages were fetched only from a channel the local bot account could already access.
- Author labels are recorded with `displayName` first.
- If `displayName` is unavailable, the fallback order is `globalName -> username -> tag`.
- Raw output is stored locally for review and should be treated as working data, not prompt content.

## Batch Strategy

Collection followed the requested staged retrieval pattern:

1. Fetch up to 100 messages per batch.
2. Filter each batch to the last 24 hours.
3. Record batch summary before continuing.
4. Sleep between batches to avoid one-shot full history pulls.
5. Stop once the oldest fetched message crosses the 24-hour lower bound.

## Batch Results

- Batch 0: `100` messages, `8` active users, avg length `12`, range `2026-04-24T13:37:10.011Z -> 2026-04-24T14:38:25.661Z`
- Batch 1: `100` messages, `9` active users, avg length `13`, range `2026-04-24T13:23:15.581Z -> 2026-04-24T13:37:06.443Z`
- Batch 2: `100` messages, `8` active users, avg length `13`, range `2026-04-24T13:11:46.344Z -> 2026-04-24T13:22:53.561Z`
- Batch 3: `100` messages, `8` active users, avg length `13`, range `2026-04-24T13:03:15.666Z -> 2026-04-24T13:11:41.513Z`
- Batch 4: `100` messages, `10` active users, avg length `11`, range `2026-04-24T12:49:30.249Z -> 2026-04-24T13:03:05.621Z`
- Batch 5: `100` messages, `11` active users, avg length `12`, range `2026-04-24T12:33:15.892Z -> 2026-04-24T12:49:16.106Z`
- Batch 6: `100` messages, `9` active users, avg length `11`, range `2026-04-24T12:14:56.555Z -> 2026-04-24T12:32:58.200Z`
- Batch 7: `100` messages, `8` active users, avg length `12`, range `2026-04-24T12:00:44.525Z -> 2026-04-24T12:14:53.516Z`
- Batch 8: `100` messages, `7` active users, avg length `7`, range `2026-04-24T11:39:10.439Z -> 2026-04-24T12:00:43.850Z`
- Batch 9: `100` messages, `16` active users, avg length `16`, range `2026-04-24T03:48:59.890Z -> 2026-04-24T11:39:04.616Z`
- Batch 10: `48` messages, `9` active users, avg length `14`, range `2026-04-23T14:41:16.409Z -> 2026-04-24T03:48:43.950Z`

## First-Pass Filtering Notes

High-value sample traits observed:

- Frequent short-turn group interaction rather than long monologues
- Topic shifts driven by social cues, jokes, comparisons, and practical opinions
- Strong signal on initiative, turn-taking, and low-latency topic extension

Unsuitable sample traits observed:

- Heavy reliance on group-private lore
- Sharp sarcasm used as primary style rather than occasional seasoning
- Boundary-risk flirting or innuendo in some active users
- High-noise reaction-only bursts with little transferable structure

## Artifact Policy

The original raw JSON dump and auto-generated summary were treated as transient working artifacts.

They are no longer kept in the repository after the documentation cleanup.
