# Pilot gate report

**Gate: NOT DECIDED YET** · 2026-11-22 01:24 UTC

No merchant sees a reply until this gate passes.

| Gate condition | Required | Now | |
|---|---|---|---|
| Coverage: every reply drafted and judged | 120 / 120 | 0 / 120 | ⏳ |
| Ingredient truth: no made-up or denied ingredients | 0 failures | 0 | ✅ |
| Final verdict PASS (all three checks) | ≥ 108 (90%) | 0 | ⏳ |

## Checks on the 0 graded replies

| Check | How | Passed |
|---|---|---|
| 1. Ingredient truth | Code. Zero tolerance | 0 / 0 |
| 2. Reply rules (plain-English names, "check with the shop", facility warning, no unsupported claims) | Code | 0 / 0 |
| 3. AI judge (accuracy, grounding, helpfulness) | promptfoo `llm-rubric`, free OpenRouter model, score ≥ 0.7 | 0 / 0 (avg score 0.00) |
| **Final verdict PASS** | All three | **0 / 0** (–) |

Progress: 116 not drafted yet · 4 drafted, waiting for a judge request · 0 judge errors (regraded next run). Free models allow 50 requests a day, so run `npm run gate` daily until coverage is complete.

## Every graded reply

| Question | product_id | Product | Ingredient truth | Reply rules | AI judge | Verdict |
|---|---|---|---|---|---|---|
