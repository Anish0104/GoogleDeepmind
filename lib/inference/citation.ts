// OWNER: Dev 2. Chooses ONE 1-4 s camera window to audit for a claim, from the original grid rows.
//
// Why: evidenceFor()/evidenceForTarget() can return runs longer than CLIP_MAX_S, and audit() rightly
// refuses them. A long run's score does not apply to a shorter interval inside it, so this helper
// never copies one: it recomputes a ranking statistic from each candidate window's own slices.
//
// Rules (pure, deterministic):
// 1. Only evidence runs that could actually drive a verdict qualify: usable, from an allowed camera,
//    and meeting the goal threshold themselves (support >= CLEAR; contradiction >= DECISIVE, which
//    evidence only reports when the run covers the whole claim window). Auditing cannot create a
//    verdict the evidence does not already allow, so other runs are not worth an audit call.
// 2. Candidate windows are consecutive observed, usable slices inside one such run, inside
//    [0, durationS] when given, then CLAMPED to the claim window: the returned window is always fully
//    inside the claim and never widened. Clamped windows shorter than CLIP_MIN_S are dropped; at most
//    CLIP_MAX_S of slices are used, so a clamped window is never longer than CLIP_MAX_S. The clipId is
//    recomputed from the clamped interval.
// 3. Each window must meet the goal on its own slices. Grid slices are 0.5 s, so with a claim edge off
//    the grid an edge slice is only partly inside the clamped window; its score may describe time
//    outside the claim. They are treated in the direction that cannot inflate:
//    - support = best 1 s of two consecutive slices FULLY inside the clamped window (partial slices
//      never contribute support);
//    - contradiction = every touching slice decisive, partial ones included;
//    - visibility = lowest over every touching slice.
//    These are approximate ranking signals for the grid only; the clamped subinterval itself was not
//    observed or scored as a unit until checkWindow() evaluates it.
// 4. Ranking: statistic, then number of slices meeting the goal, then lowest visibility (higher first),
//    then camera order, then earliest start.
//
// The result is a CitationCandidate, NOT Evidence: it carries no support/contradiction score and is
// marked verified: false. It is independently checked only when checkWindow() evaluates exactly that
// camera and window (lib/truth/auditor.ts auditCitation()). The original evidence is not changed.
import type { CameraId, Claim, GridRow, Question } from "@/lib/types";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { CAMERA_IDS } from "@/lib/inference/grid";
import { evidenceForTarget, gridClipId, targetSlices, type EvidenceTarget, type TargetSlice } from "@/lib/inference/evidence";

export type CitationGoal = "support" | "contradict";

export interface CitationOptions {
  goal: CitationGoal;
  /** Cameras the citation may come from. Excluded cameras must simply not be listed. */
  allowedCameras: readonly CameraId[];
  /** Scene length in seconds; the window never extends past it. */
  durationS?: number;
}

export interface CitationCandidate {
  camera: CameraId;
  window: [number, number];
  /** Grid reference of exactly this window (same format as Evidence.clipId). */
  clipId: string;
  goal: CitationGoal;
  /** clipId of the evidence run this window lies inside (provenance). */
  sourceEvidenceClipId: string;
  /**
   * Grid-derived ranking facts about THIS window only. Not an audit score, not a confidence.
   * slices = grid slices touching the window; partialSlices = those only partly inside it (claim edge
   * off the 0.5 s grid); goalSlices = slices meeting the goal (support: fully inside ones only).
   */
  basis: { slices: number; partialSlices: number; goalSlices: number; minVisible: number; gridStatistic: number };
  /** Always false: only checkWindow() on this exact window verifies it. */
  verified: false;
}

export type CitationResult = { ok: true; candidate: CitationCandidate } | { ok: false; reason: string };

const EPS = 1e-6;
const MAX_SLICES = Math.floor(LIMITS.CLIP_MAX_S / LIMITS.SLICE_S + EPS);
const MIN_SLICES = Math.ceil(LIMITS.CLIP_MIN_S / LIMITS.SLICE_S - EPS);

/**
 * Ranking statistic for one window. `touching` = all slices touching the clamped window; `full` = the
 * consecutive subset lying fully inside it. Support uses only full slices; contradiction needs every
 * touching slice decisive (see header, rule 3).
 */
function windowStat(touching: TargetSlice[], full: TargetSlice[], goal: CitationGoal): { stat: number; goalSlices: number } | null {
  if (goal === "support") {
    let best: number | null = null;
    for (let i = 0; i + 1 < full.length; i++) {
      const a = full[i]!.support;
      const b = full[i + 1]!.support;
      if (a === null || b === null) continue;
      best = best === null ? Math.min(a, b) : Math.max(best, Math.min(a, b));
    }
    if (best === null || best < THRESHOLDS.CLEAR) return null;
    return { stat: best, goalSlices: full.filter((s) => s.support !== null && s.support >= THRESHOLDS.CLEAR).length };
  }
  if (touching.some((s) => s.contradiction === null)) return null;
  const worst = Math.min(...touching.map((s) => s.contradiction!));
  if (worst < THRESHOLDS.DECISIVE) return null;
  return { stat: worst, goalSlices: touching.length };
}

export function selectCitation(
  claim: Claim,
  target: EvidenceTarget | null,
  rows: GridRow[],
  questions: Question[],
  opts: CitationOptions,
): CitationResult {
  const no = (reason: string): CitationResult => ({ ok: false, reason });
  if (opts.goal !== "support" && opts.goal !== "contradict") return no(`unknown goal ${String(opts.goal)}`);
  if (!Array.isArray(opts.allowedCameras)) return no("allowedCameras must be a list");
  if (opts.durationS !== undefined && !(Number.isFinite(opts.durationS) && opts.durationS > 0))
    return no(`invalid durationS ${opts.durationS}`);
  const allowed = new Set(opts.allowedCameras.filter((c) => CAMERA_IDS.includes(c)));
  if (allowed.size === 0) return no("no allowed cameras");

  const series = targetSlices(claim, target, rows, questions);
  if (!series) return no("claim target is not grounded");

  const goalMet = (supports: number | null, contradicts: number | null) =>
    opts.goal === "support" ? supports !== null && supports >= THRESHOLDS.CLEAR : contradicts !== null && contradicts >= THRESHOLDS.DECISIVE;
  const qualifying = evidenceForTarget(claim, target, rows, questions).filter(
    (e) => allowed.has(e.camera) && e.visible >= THRESHOLDS.USABLE && goalMet(e.supports, e.contradicts),
  );
  const goalName = opts.goal === "support" ? "support at CLEAR" : "contradiction at DECISIVE";
  if (qualifying.length === 0) return no(`no evidence run from an allowed camera reaches ${goalName}`);

  const [c0, c1] = claim.window;
  if (!(Number.isFinite(c0) && Number.isFinite(c1) && c1 > c0)) return no("invalid claim window");

  type Scored = {
    camera: CameraId;
    window: [number, number];
    source: string;
    slices: number;
    partialSlices: number;
    goalSlices: number;
    minVisible: number;
    stat: number;
  };
  const scored: Scored[] = [];
  for (const run of qualifying) {
    let inside = (series.get(run.camera) ?? []).filter(
      (s) => s.usable && s.t >= run.window[0] - EPS && s.t + LIMITS.SLICE_S <= run.window[1] + EPS,
    );
    if (opts.durationS !== undefined) inside = inside.filter((s) => s.t + LIMITS.SLICE_S <= opts.durationS! + EPS);
    const n = Math.min(MAX_SLICES, inside.length);
    if (n < MIN_SLICES) continue;
    for (let i = 0; i + n <= inside.length; i++) {
      const touching = inside.slice(i, i + n);
      // Clamp to the claim (and the scene); never widen.
      const a = Math.max(touching[0]!.t, c0);
      let b = Math.min(touching.at(-1)!.t + LIMITS.SLICE_S, c1);
      if (opts.durationS !== undefined) b = Math.min(b, opts.durationS);
      if (!(b - a >= LIMITS.CLIP_MIN_S - EPS)) continue;
      const full = touching.filter((s) => s.t >= a - EPS && s.t + LIMITS.SLICE_S <= b + EPS);
      const s = windowStat(touching, full, opts.goal);
      if (!s) continue;
      scored.push({
        camera: run.camera,
        window: [a, b],
        source: run.clipId,
        slices: touching.length,
        partialSlices: touching.length - full.length,
        goalSlices: s.goalSlices,
        minVisible: Math.min(...touching.map((x) => x.visible)),
        stat: s.stat,
      });
    }
  }
  if (scored.length === 0) return no(`no ${LIMITS.CLIP_MIN_S}-${LIMITS.CLIP_MAX_S} s window inside a qualifying run meets ${goalName} on its own slices`);

  scored.sort(
    (a, b) =>
      b.stat - a.stat ||
      b.goalSlices - a.goalSlices ||
      b.minVisible - a.minVisible ||
      CAMERA_IDS.indexOf(a.camera) - CAMERA_IDS.indexOf(b.camera) ||
      a.window[0] - b.window[0],
  );
  const best = scored[0]!;
  return {
    ok: true,
    candidate: {
      camera: best.camera,
      window: best.window,
      clipId: gridClipId(claim.sceneId, best.camera, best.window),
      goal: opts.goal,
      sourceEvidenceClipId: best.source,
      basis: {
        slices: best.slices,
        partialSlices: best.partialSlices,
        goalSlices: best.goalSlices,
        minVisible: best.minVisible,
        gridStatistic: best.stat,
      },
      verified: false,
    },
  };
}
