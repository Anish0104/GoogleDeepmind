# Dev 1: Evidence Engine (video in, probabilities out)

Gets synced video off the phones and turns it into probabilities every other dev uses.

## You own

`app/phone/`, `app/api/ingest/`, `lib/gemini/client.ts`, `lib/video/`, `lib/capture/`, `lib/perception/`, `scripts/killtests/a.ts`, `e.ts`, `f.ts`.

## Build, in order

1. `checkWindow()` in `lib/perception/checkWindow.ts`: cut a clip and ask Decision 1 about it. **Ship first**: Dev 2's auditor and Dev 3's bridge call it.
2. `lib/gemini/client.ts`: one wrapped client that every dev uses; logs a `CostRecord` per call to `logs/costs.jsonl`; respects `MAX_CONCURRENT_CALLS`; retries with backoff.
3. `lib/video/ffmpeg.ts`: `clip()`, `crop()`, `still()`, `audio()` with `child_process.spawn`.
4. Phone page and `/api/ingest`: `MediaRecorder`, 1-second chunks, clap button and full-screen flash.
5. `lib/capture/sync.ts` (clap cross-correlation + flash refine) and `slice.ts` (0.5 s slices, stills).
6. `lib/perception/scout.ts` and `views.ts` (Hydrogen), `lattice.ts` (Decision 1 grid, appended to `grid.jsonl`), `match.ts`, `candidates.ts`.

## First hour

A ~30-line grid caller on one starter clip; the HTTPS phone test on one phone; confirm model ID strings and rate limits on the free tier.

## Kill tests

- **A:** calibration error 0.10 or less, AUROC 0.85 or more, visibility questions 90% right.
- **E:** 4 cameras x 30 slices answered in under 10 s with no rate-limit errors (needs event credits).
- **F:** sync within 1 frame.

## Prompt for Claude Code

> I'm Dev 1 (Evidence Engine) on RASHOMON. Read CLAUDE.md, README.md, lib/types.ts, lib/config.ts and docs/DEV1-evidence-engine.md. I only edit the files listed under "You own". Start with checkWindow() in lib/perception/checkWindow.ts: write Vitest tests first, using a fixture clip, then implement it with lib/video/ffmpeg.ts and a Decision 1 call through lib/gemini/client.ts. Parse every model output with zod. Keep calls under MAX_CONCURRENT_CALLS because we're on the free tier.
