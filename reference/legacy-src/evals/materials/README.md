# Eval Materials

This directory stores sanitized evaluation material.

- `curated/`: committed JSONL fixtures used by evals.
- `sanitized/`: optional intermediate sanitized records.
- `raw/`: local-only working captures; do not commit private raw logs.

Fixtures should use stable aliases such as `owner_a`, `trusted_a`, `external_a`, and `viewer_a`.
Do not store real Discord IDs, live chat IDs, tokens, private URLs, or unredacted user names.
