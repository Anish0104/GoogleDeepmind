# Dev 2: Reasoning Core (probabilities in, labels out)

Every label on the board comes from this code, and nothing else may set one.

## You own

`lib/inference/`, the thresholds in `lib/config.ts`, `lib/truth/`, `eval/baselines.ts`, `app/api/scene/[id]/account/`, `scripts/killtests/b.ts`, `c.ts`, `d.ts`.

## Build, in order

1. `verdict()` and `enforceDowngradeOnly()` in `lib/inference/verdict.ts`, with a test for every branch, including a vague-time claim and two cameras that disagree. **Ship first**: Dev 3 uses them.
2. `lib/inference/fake-grid.ts`: synthetic grids with known truth, adjustable noise and errors shared between cameras.
3. `lib/inference/evidence.ts`: per-camera evidence; only views with visibility of `USABLE` or more count; never average cameras.
4. `lib/inference/state.ts`: simple event tracking (positions over zones A-F turned into events; no teleporting).
5. `lib/truth/claims.ts` (Carbon: account to `Claim[]`), `auditor.ts` (Decision 1 on the cited clip only, through Dev 1's `checkWindow()`), `judge.ts` (Carbon cited timeline; reject any sentence without a camera and time).
6. `eval/baselines.ts`: single camera, Carbon reading the clips, Neon (Carbon if Neon isn't available).

## The verdict rules

- **Supported:** a usable view supports at `CLEAR` or more, none contradicts, and the audit support score is `CLEAR` or more.
- **Contradicted:** a usable view contradicts at `DECISIVE` or more, none supports, the audit contradict score is `DECISIVE` or more, and if the claim's time is vague, usable views cover the whole window.
- **Everything else:** Insufficient. A low score never means false.

## Kill tests

- **B:** several cameras beat a single camera by 10 points or more, and at least tie Carbon reading all clips.
- **C:** event F1 of 0.75 or more.
- **D:** zero true or unseeable claims labeled Contradicted; at least 3 of 5 false claims caught.

## Prompt for Claude Code

> I'm Dev 2 (Reasoning Core) on RASHOMON. Read CLAUDE.md, README.md, lib/types.ts, lib/config.ts and docs/DEV2-reasoning-core.md. I only edit the files listed under "You own". Start with verdict() and enforceDowngradeOnly() in lib/inference/verdict.ts: write a Vitest test for every branch of the rules in my doc first, then implement them exactly. Thresholds come from THRESHOLDS in lib/config.ts. Then build fake-grid.ts so I can work without real model calls.
