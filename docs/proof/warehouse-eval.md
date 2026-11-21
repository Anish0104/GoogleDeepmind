# Warehouse eval

**Not run yet.** No results are reported here until `scripts/eval/run-warehouse.ts` has been run on real
scenes; every number in this file must come from that run (`--doc` replaces this file with its report).

## How to run

```bash
pnpm tsx scripts/eval/gen-accounts.ts <sceneId…>        # data/eval/cases/<sceneId>.json
pnpm tsx scripts/eval/run-warehouse.ts --doc <sceneId…> # runs account + agents, writes this file
```

Each scene must already be perceived (`POST /api/scene/<id>/run` → status `perceived`) and have
`data/labels/<sceneId>.truth.json`. Agent mode follows `AGENT_MODE` (stand-in unless set to `managed`).

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
- **Statements** are a bystander's, in the third person, one sentence each (e.g. "The forklift hit the worker.").
- **Scoring:** each extracted claim is matched to at most one statement, on word overlap or containment (a claim
  split off a statement, or the claim's object + action, inside it), negation-aware. A statement with no match
  is an extraction miss; a claim with no statement is listed as an extra claim. **Critical error** = Supported on
  a false statement or Contradicted on a true one (target 0). **Coverage loss** = Insufficient where a decision
  was possible. **Overreach** = a label where the worker wasn't visible. Rates carry 95% Wilson intervals.
- **Grid column:** the claim re-grounded as runAccount() grounds it, and the best grid score for that question
  on included cameras near the moment, against the 0.8 threshold; "ungrounded" gives Dev 2's reason.
