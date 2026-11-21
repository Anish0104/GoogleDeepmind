// OWNER: Dev 1. Per-question Platt curves for the grid, per question set. `pnpm killtest a --fit`
// writes fitted curves here; perceiveScene() applies them by default (raw answers kept in grid.raw.jsonl).
//
// Deliberately EMPTY. Fitted on 13 SDG near-miss scenes, curves cut held-out calibration error
// (near_worker 0.186 -> 0.034, touching_worker 0.106 -> 0.061) but created confident false positives:
// touching reached 0.85 on a clean 0.25 m near miss and near_worker was >= 0.8 on 14 of 212 "no"
// slices, i.e. above Dev 2's 0.8 support threshold, which assumes the grid errs low. moving and dodging
// cannot be fitted safely: the data is ~95% "yes". Re-fit only with data that has real "no" cases
// (e.g. our own recording, where the forklift stops) and re-check false positives before enabling.
export const GRID_CALIBRATION: Record<string, Record<string, { a: number; b: number; n: number }>> = {};
