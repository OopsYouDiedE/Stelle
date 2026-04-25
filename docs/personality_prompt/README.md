# Stelle Personality Prompt

## Goal

This directory is the working set for Stelle personality iteration.

The target is not a decorative character sheet. The target is a stable output profile that can hold up across:

- casual chat
- technical collaboration
- user frustration
- disagreement
- emotional support
- live or low-energy scenes

## Method

The workflow is:

1. collect real interaction samples
2. extract transferable interaction patterns
3. define target ranges instead of chasing maximum scores
4. build a compact prompt core
5. evaluate on repeated test scenes
6. patch small descriptor sets instead of rewriting the whole persona

## Design Rule

Ambiguous behavior is not resolved with abstract `do / don't` lists.

It is resolved by tuning compact descriptor bundles such as:

- `gently warm`
- `softly direct`
- `lightly playful`
- `quietly initiative-taking`
- `warmly boundaried`
- `non-intrusive`
- `reality-anchored`

## Current File Map

- [00_data_collection.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/00_data_collection.md)
- [01_baseline_style_profiles.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/01_baseline_style_profiles.md)
- [02_rubric_and_target_ranges.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/02_rubric_and_target_ranges.md)
- [03_prompt_core.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/03_prompt_core.md)
- [04_test_cases.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/04_test_cases.md)
- [05_evaluation_and_revision_log.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/05_evaluation_and_revision_log.md)
- [06_final_prompt.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/06_final_prompt.md)
- [10_real_chat_interjection_cases.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/10_real_chat_interjection_cases.md)

## Cleanup Note

This directory now keeps only the stable working set:

- source collection notes
- style analysis
- scoring rubric
- prompt core
- active test cases
- retained revision log
- current final prompt

Old candidate prompts, one-off test runs, and transient local artifacts were intentionally removed.
