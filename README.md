# RASHOMON

Several phones film one event. RASHOMON checks each claim in a person's spoken account against the footage and labels it **Supported**, **Contradicted by visible evidence**, or **Insufficient footage**. It labels claims, never people.

Built for the Gemini 4 NYC Hackathon (Problem Statement Two: Element 119), with an entry for Best Use of Managed Agents.

## Pre-event disclosure

Commits dated before **10:30 AM ET, Nov 21, 2026** contain **scaffolding only**: tooling config, the folder layout, the shared types file, configuration constants, and empty function stubs that throw "not implemented". They contain no project logic. Every function body, prompt behavior, UI and evaluation was written during the event. Compare any file against the last pre-event commit to see exactly what was built at the hackathon.

## Quick start

```bash
pnpm install
cp .env.local.example .env.local   # add your GEMINI_API_KEY
pnpm dev:https                     # phones need HTTPS for the camera
pnpm test                          # vitest
pnpm typecheck
```

Open `https://<laptop-ip>:3000/phone?scene=<id>&cam=A` on each phone and `https://localhost:3000` for the board.

Other commands:

```bash
pnpm killtest a        # kill tests a-h (see docs/)
pnpm scriptgen         # random scene scripts for the benchmark
pnpm eval:run          # run the pipeline over a split
pnpm eval:report       # results table with confidence intervals
```

## How it works

1. **Capture and sync** (Dev 1): 4 phones record around a mat with zones A-F; a clap and a screen flash line them up.
2. **Evidence** (Dev 1): Gemini 4 Hydrogen lists objects and yes/no questions; the Gemini Decisions API answers every question for every camera and half-second slice with a probability.
3. **Labels** (Dev 2): fixed TypeScript rules in `verdict()` turn per-camera evidence into a label. Contradicted is the hardest label to get. Gemini 4 Carbon splits the spoken account into claims and writes a cited timeline.
4. **Agents** (Dev 3): two Gemini Managed Agents pick extra clips to check. The **Investigator** settles undecided claims; the **Skeptic** looks for footage that would break a decided label and can only downgrade it. Neither agent ever sets a label.
5. **Board and proof** (Dev 4): the live board, the labeling tool, the benchmark and the results report.

## Repo layout

| Folder | Owner | What lives there |
|---|---|---|
| `app/phone`, `app/api/ingest`, `lib/gemini`, `lib/video`, `lib/capture`, `lib/perception` | Dev 1: Evidence Engine | Capture, sync, slicing, scout, the grid, `checkWindow()` |
| `lib/inference`, `lib/truth`, `lib/config.ts` (thresholds), `eval/baselines.ts`, `app/api/scene/[id]/account` | Dev 2: Reasoning Core | Evidence, events, `verdict()`, claims, auditor, judge, baselines |
| `lib/types.ts`, `lib/agent`, `lib/store`, `lib/cost.ts`, other API routes, `eval/agents-compare.ts`, repo config | Dev 3: Agents & Platform | Repo, pipeline runner, bridge, Investigator, Skeptic, cost meter |
| `app/page.tsx`, `components`, `app/label`, `app/results`, `scripts/scriptgen.ts`, `eval/run.ts`, `eval/stats.ts`, `eval/report.ts` | Dev 4: Product & Proof | Board UI, labeling, benchmark, results, pitch |

See `CONTRIBUTING.md` for the rules and `docs/` for each dev's brief.

## Privacy

Raw video stays on the laptop. Only short validated clips (4 s or less) and low-res stills go to the models. No face recognition. Footage is deleted after the event unless the actor agrees to keep it.
