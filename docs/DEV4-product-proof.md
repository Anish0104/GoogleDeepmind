# Dev 4: Product & Proof (scene files in, demo and results out)

Owns everything the judges see and the evidence behind it.

## You own

`app/page.tsx` (the board), `app/layout.tsx`, `app/globals.css`, `components/`, `app/label/`, `app/results/`, `scripts/scriptgen.ts`, `eval/run.ts`, `eval/stats.ts`, `eval/report.ts`, `fixtures/replay/`.

## Build, in order

1. The board rendering a replay file from `fixtures/replay/`, so the UI never waits on the pipeline. **Ship first.**
2. Board: four camera tiles (the covered one goes gray), the live grid, claim rows with playable clips and label history, the agent trace panel (from Dev 3's stream), the cost meter display, and an operator "exclude camera" toggle.
3. `scripts/scriptgen.ts`: random 3-6 action scripts (move, swap, hand over, hide, open, tip over), about a third with a planned occlusion.
4. `/label`: two labelers mark what actually happened and label each claim from the footage; they never see system output.
5. `eval/stats.ts` (Wilson intervals, one sample per scene), `eval/run.ts`, `eval/report.ts` (false-contradiction rate first).
6. `/results`, the recorded demo backup, the pitch deck, the Devpost write-up and the 1-minute video.

## Tests

A full demo dry run with no manual steps, and labeler agreement of 85% or more.

## Prompt for Claude Code

> I'm Dev 4 (Product & Proof) on RASHOMON. Read CLAUDE.md, README.md, lib/types.ts and docs/DEV4-product-proof.md. I only edit the files listed under "You own". Start with the board in app/page.tsx and components/: render the replay file in fixtures/replay/ (types from lib/types.ts) with four camera tiles, claim rows with label history and an agent trace panel. Use Tailwind. Then write eval/stats.ts with a Vitest-tested Wilson interval.
