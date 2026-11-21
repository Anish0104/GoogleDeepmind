# Warehouse eval

Generated 2026-11-21T21:18:49.243Z by `scripts/eval/run-warehouse.ts`. Agent mode: standin.

Critical errors (target 0) | 0 of 24 matched statements, 95% interval 0% [0–14%]

## Summary

| | Statements | Matched | Extraction misses | Extra claims | Critical errors (target 0) | Correct | Coverage loss | Overreach | Expected-Insufficient handled | Changed by agents (fixed / broke) |
|---|---|---|---|---|---|---|---|---|---|---|
| **All scenes** | 30 | 24 | 6 | 0 | 0 of 24 (before agents: 0) | 5 of 24 · 21% [9–40%] | 19 | 0 | 0 of 0 | 5 (5 / 0) |
| sdg_nearmiss_run02 | 10 | 8 | 2 | 0 | 0 of 8 (before agents: 0) | 2 of 8 · 25% [7–59%] | 6 | 0 | 0 of 0 | 2 (2 / 0) |
| sdg_nearmiss_run10 | 10 | 8 | 2 | 0 | 0 of 8 (before agents: 0) | 2 of 8 · 25% [7–59%] | 6 | 0 | 0 of 0 | 2 (2 / 0) |
| sdg_nearmiss_run25 | 10 | 8 | 2 | 0 | 0 of 8 (before agents: 0) | 1 of 8 · 13% [2–47%] | 7 | 0 | 0 of 0 | 1 (1 / 0) |

## Every statement: before → after agents

| Scene | Account | Statement | True? | Expected | Label (before → after) | Outcome | Grid near the moment (why) |
|---|---|---|---|---|---|---|---|
| sdg_nearmiss_run02 | true | contact | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "never touched" is not a canonical claim action |
| sdg_nearmiss_run02 | true | dodge | true | Supported | not extracted | miss | — |
| sdg_nearmiss_run02 | true | stop | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run02 | true | moving | true | Supported | Insufficient → Supported | correct | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run02 | true | time | true | Supported | Insufficient → Supported | correct | ungrounded: action "was near" is not a canonical claim action |
| sdg_nearmiss_run02 | mixed | contact | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "never touched" is not a canonical claim action |
| sdg_nearmiss_run02 | mixed | dodge | true | Supported | not extracted | miss | — |
| sdg_nearmiss_run02 | mixed | stop | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run02 | mixed | moving | false | Contradicted | Insufficient → Insufficient | coverage-loss | ungrounded: no state question for "stopped" on forklift |
| sdg_nearmiss_run02 | mixed | time | false | Contradicted | Insufficient → Insufficient | coverage-loss | ungrounded: action "was near" is not a canonical claim action |
| sdg_nearmiss_run10 | true | contact | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run10 | true | dodge | true | Supported | not extracted | miss | — |
| sdg_nearmiss_run10 | true | stop | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run10 | true | moving | true | Supported | Insufficient → Supported | correct | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run10 | true | time | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run10 | mixed | contact | false | Contradicted | Insufficient → Insufficient | coverage-loss | ungrounded: action "never touched" is not a canonical claim action |
| sdg_nearmiss_run10 | mixed | dodge | true | Supported | not extracted | miss | — |
| sdg_nearmiss_run10 | mixed | stop | false | Contradicted | Insufficient → Insufficient | coverage-loss | ungrounded: no state question for "stopped" on forklift |
| sdg_nearmiss_run10 | mixed | moving | true | Supported | Insufficient → Supported | correct | moving max 0.93 ≥ 0.8 (cam A at 2.5 s) |
| sdg_nearmiss_run10 | mixed | time | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run25 | true | contact | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run25 | true | dodge | true | Supported | not extracted | miss | — |
| sdg_nearmiss_run25 | true | stop | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run25 | true | moving | true | Supported | Insufficient → Supported | correct | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run25 | true | time | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run25 | mixed | contact | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |
| sdg_nearmiss_run25 | mixed | dodge | false | Contradicted | not extracted | miss | — |
| sdg_nearmiss_run25 | mixed | stop | false | Contradicted | Insufficient → Insufficient | coverage-loss | ungrounded: no state question for "stopped" on forklift |
| sdg_nearmiss_run25 | mixed | moving | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "moving" is not a canonical claim action |
| sdg_nearmiss_run25 | mixed | time | true | Supported | Insufficient → Insufficient | coverage-loss | ungrounded: action "touching" is not a canonical claim action |

## Method

- **Scenes:** NVIDIA PhysicalAI SDG-Warehouse `forklift_human_nearmiss` runs, imported as presynced scenes and
  perceived once. The answer key is `data/labels/<sceneId>.truth.json`; only `scripts/eval/` reads it.
- **Accounts:** per scene, `scripts/eval/gen-accounts.ts` writes a "true" account (every statement true) and a
  "mixed" account (2 statements flipped to false), deterministic per scene. Statements: contact, dodge, stop,
  moving, time. A statement whose field is missing from the answer key is left out.
- **Expected label:** Insufficient if no included camera sees the worker in the slices around the moment;
  otherwise Supported for a true statement and Contradicted for a false one.
- **Run:** each account runs on its own clone of the scene (`<sceneId>__<account>`): Dev 2's `runAccount()`
  (claims → grounding → evidence → citation → audit → verdict), then our agents (`POST .../agents`).
- **Statements** are a bystander's, in the third person, one atomic state sentence each (e.g. "The forklift was touching the worker.").
- **Scoring:** each extracted claim is matched to at most one statement, on word overlap or containment (a claim
  split off a statement, or the claim's object + action, inside it), negation-aware. A statement with no match
  is an extraction miss; a claim with no statement is listed as an extra claim. **Critical error** = Supported on
  a false statement or Contradicted on a true one (target 0). **Coverage loss** = Insufficient where a decision
  was possible. **Overreach** = a label where the worker wasn't visible. Rates carry 95% Wilson intervals.
- **Grid column:** the claim re-grounded as runAccount() grounds it, and the best grid score for that question
  on included cameras near the moment, against the 0.8 threshold; "ungrounded" gives Dev 2's reason.
