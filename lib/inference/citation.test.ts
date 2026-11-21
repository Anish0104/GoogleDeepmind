// OWNER: Dev 2. Tests for selectCitation(): choosing one 1-4 s camera window to audit, from grid rows.
import { describe, expect, it } from "vitest";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { selectCitation, type CitationOptions } from "@/lib/inference/citation";
import { evidenceForTarget, gridClipId, type EvidenceTarget } from "@/lib/inference/evidence";
import type { CameraId, Claim, GridRow, Question } from "@/lib/types";

const QS: Question[] = [
  { id: "mugB", entityId: "e1", predicate: "location", value: "B", text: "Is the mug in zone B?" },
  { id: "mugC", entityId: "e1", predicate: "location", value: "C", text: "Is the mug in zone C?" },
];
const TO_C: EvidenceTarget = { questionId: "mugC", alternativeIds: ["mugB"] };
const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "c1",
  sceneId: "s1",
  text: "Sam put the mug in zone C",
  actor: "Sam",
  object: "mug",
  action: "move to zone C",
  window: [10, 12],
  timeIsPrecise: true,
  ...o,
});
function fill(camera: CameraId, t0: number, t1: number, values: Record<string, number>, pVisible = 0.95): GridRow[] {
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries(values)) rows.push({ sceneId: "s1", camera, t, questionId, pYes, pVisible });
  return rows;
}
const IN_C = { mugC: 0.95, mugB: 0.05 };
const IN_B = { mugC: 0.03, mugB: 0.96 };
const ALL: CameraId[] = ["A", "B", "C", "D"];
const sup = (o: Partial<CitationOptions> = {}): CitationOptions => ({ goal: "support", allowedCameras: ALL, ...o });
const con = (o: Partial<CitationOptions> = {}): CitationOptions => ({ goal: "contradict", allowedCameras: ALL, ...o });

const len = (w: [number, number]) => w[1] - w[0];

describe("selectCitation: window shape", () => {
  it("cuts a 4 s window out of a long supporting run, preferring the most supporting slices", () => {
    const c = claim({ window: [0, 12], timeIsPrecise: false });
    const rows = [...fill("A", 0, 6, IN_B), ...fill("A", 6, 12, IN_C)];
    const e = evidenceForTarget(c, TO_C, rows, QS);
    expect(e).toHaveLength(1);
    expect(len(e[0]!.window)).toBe(12); // too long to audit as-is
    const r = selectCitation(c, TO_C, rows, QS, sup());
    expect(r).toMatchObject({ ok: true, candidate: { camera: "A", window: [6, 10], goal: "support", verified: false } });
    if (!r.ok) return;
    expect(r.candidate.clipId).toBe(gridClipId("s1", "A", [6, 10]));
    expect(r.candidate.sourceEvidenceClipId).toBe(e[0]!.clipId);
  });

  it("uses a short valid run whole", () => {
    const r = selectCitation(claim(), TO_C, fill("A", 10, 12, IN_C), QS, sup());
    expect(r).toMatchObject({ ok: true, candidate: { window: [10, 12] } });
  });

  it("rejects runs shorter than CLIP_MIN_S", () => {
    const r = selectCitation(claim({ window: [10, 10.4] }), TO_C, fill("A", 10, 10.5, IN_C), QS, sup());
    expect(r).toMatchObject({ ok: false });
  });

  it("every candidate window is finite, ordered, 1-4 s, overlaps the claim and is made of observed slices", () => {
    for (const [w, rows] of [
      [[0, 20], fill("A", 0, 20, IN_C)],
      [[3, 5], fill("A", 0, 20, IN_C)],
      [[10, 13], [...fill("A", 10, 11, IN_C), ...fill("A", 11.5, 13, IN_C)]],
    ] as [[number, number], GridRow[]][]) {
      const r = selectCitation(claim({ window: w }), TO_C, rows, QS, sup());
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const [a, b] = r.candidate.window;
      expect(Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a).toBe(true);
      expect(len(r.candidate.window)).toBeGreaterThanOrEqual(LIMITS.CLIP_MIN_S);
      expect(len(r.candidate.window)).toBeLessThanOrEqual(LIMITS.CLIP_MAX_S);
      expect(a < w[1] && b > w[0]).toBe(true);
      const observed = new Set(rows.filter((x) => x.camera === r.candidate.camera).map((x) => x.t));
      for (let t = a; t < b - 1e-9; t += LIMITS.SLICE_S) expect(observed.has(t)).toBe(true);
    }
  });

  it("never spans a missing slice", () => {
    const rows = [...fill("A", 10, 11, IN_C), ...fill("A", 11.5, 13, IN_C)];
    const r = selectCitation(claim({ window: [10, 13] }), TO_C, rows, QS, sup());
    expect(r).toMatchObject({ ok: true, candidate: { window: [11.5, 13] } });
  });
});

describe("selectCitation: what the window must show", () => {
  it("conflicting cameras: support picks the supporting camera, contradiction the contradicting one", () => {
    const rows = [...fill("A", 10, 12, IN_C), ...fill("B", 10, 12, IN_B)];
    expect(selectCitation(claim(), TO_C, rows, QS, sup())).toMatchObject({ ok: true, candidate: { camera: "A" } });
    expect(selectCitation(claim(), TO_C, rows, QS, con())).toMatchObject({ ok: true, candidate: { camera: "B", goal: "contradict" } });
  });

  it("support and contradiction intervals on one camera: support picks the supporting interval", () => {
    const c = claim({ window: [0, 12], timeIsPrecise: false });
    const rows = [...fill("A", 0, 6, IN_B), ...fill("A", 6, 12, IN_C)];
    const r = selectCitation(c, TO_C, rows, QS, sup());
    expect(r.ok && r.candidate.window[0]).toBeGreaterThanOrEqual(6);
  });

  it("contradiction needs an evidence run that is decisive throughout the claim window", () => {
    const c = claim({ window: [0, 12], timeIsPrecise: false });
    const rows = [...fill("A", 0, 6, IN_B), ...fill("A", 6, 12, IN_C)];
    expect(selectCitation(c, TO_C, rows, QS, con())).toMatchObject({ ok: false });
  });

  it("does not inflate: a decisive sub-window inside a run that is not decisive overall is not selected", () => {
    const rows = [...fill("A", 10, 11.5, IN_B), ...fill("A", 11.5, 12, { mugC: 0.5, mugB: 0.5 }), ...fill("A", 12, 15, IN_B)];
    const c = claim({ window: [10, 15] });
    const e = evidenceForTarget(c, TO_C, rows, QS);
    expect(e[0]!.contradicts!).toBeLessThan(THRESHOLDS.DECISIVE);
    expect(selectCitation(c, TO_C, rows, QS, con())).toMatchObject({ ok: false });
  });

  it("the ranking statistic is recomputed from the window's own slices", () => {
    const rows = [...fill("A", 10, 11, { mugC: 0.82, mugB: 0.05 }), ...fill("A", 11, 12, { mugC: 0.97, mugB: 0.02 })];
    const r = selectCitation(claim(), TO_C, rows, QS, sup());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate.basis.slices).toBe(4);
    expect(r.candidate.basis.minVisible).toBeCloseTo(0.95);
    expect(r.candidate.basis.gridStatistic).toBeCloseTo(0.97);
  });

  it("returns a candidate, not Evidence: no support or contradiction scores to misuse", () => {
    const r = selectCitation(claim(), TO_C, fill("A", 10, 12, IN_C), QS, sup());
    expect(r.ok && "supports" in r.candidate).toBe(false);
    expect(r.ok && "contradicts" in r.candidate).toBe(false);
  });

  it("no suitable citation when the grid never reaches the goal threshold", () => {
    const r = selectCitation(claim(), TO_C, fill("A", 10, 12, { mugC: 0.7, mugB: 0.1 }), QS, sup());
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no evidence run/) });
  });
});

describe("selectCitation: coverage and constraints", () => {
  it("never selects occluded slices", () => {
    expect(selectCitation(claim(), TO_C, fill("A", 10, 12, IN_C, 0.2), QS, sup())).toMatchObject({ ok: false });
    const rows = [...fill("A", 10, 11, IN_C, 0.2), ...fill("A", 11, 13, IN_C)];
    expect(selectCitation(claim({ window: [10, 13] }), TO_C, rows, QS, sup())).toMatchObject({ ok: true, candidate: { window: [11, 13] } });
  });

  it("stays inside the scene duration", () => {
    const r = selectCitation(claim({ window: [10, 13] }), TO_C, fill("A", 9, 14, IN_C), QS, sup({ durationS: 12 }));
    expect(r.ok && r.candidate.window[1]).toBeLessThanOrEqual(12);
  });

  it("rejects an invalid duration", () => {
    for (const durationS of [0, -1, Number.NaN]) expect(selectCitation(claim(), TO_C, fill("A", 10, 12, IN_C), QS, sup({ durationS }))).toMatchObject({ ok: false });
  });

  it("only uses allowed cameras (excluded cameras never appear)", () => {
    const rows = [...fill("A", 10, 12, IN_C), ...fill("B", 10, 12, { mugC: 0.85, mugB: 0.05 })];
    expect(selectCitation(claim(), TO_C, rows, QS, sup({ allowedCameras: ["B"] }))).toMatchObject({ ok: true, candidate: { camera: "B" } });
    expect(selectCitation(claim(), TO_C, rows, QS, sup({ allowedCameras: ["C", "D"] }))).toMatchObject({ ok: false });
    expect(selectCitation(claim(), TO_C, rows, QS, sup({ allowedCameras: [] }))).toMatchObject({ ok: false });
  });

  it("an ungrounded target never yields a citation", () => {
    expect(selectCitation(claim(), null, fill("A", 10, 12, IN_C), QS, sup())).toMatchObject({ ok: false });
  });

  it("ties break deterministically: best statistic, then visibility, then camera order, then earliest", () => {
    const rows = [...fill("B", 10, 12, IN_C), ...fill("A", 10, 12, IN_C)];
    expect(selectCitation(claim(), TO_C, rows, QS, sup())).toMatchObject({ ok: true, candidate: { camera: "A" } });
    const vis = [...fill("A", 10, 12, IN_C, 0.7), ...fill("B", 10, 12, IN_C, 0.9)];
    expect(selectCitation(claim(), TO_C, vis, QS, sup())).toMatchObject({ ok: true, candidate: { camera: "B" } });
    expect(selectCitation(claim(), TO_C, rows, QS, sup())).toEqual(selectCitation(claim(), TO_C, rows, QS, sup()));
  });

  it("does not mutate its inputs", () => {
    const rows = fill("A", 10, 12, IN_C);
    const c = claim();
    const snap = JSON.stringify([c, rows, QS, TO_C]);
    selectCitation(c, TO_C, rows, QS, sup());
    expect(JSON.stringify([c, rows, QS, TO_C])).toBe(snap);
  });
});

// ---------- containment in the claim window (non-grid-aligned claims) ----------

describe("selectCitation: windows are contained in the claim", () => {
  const within = (w: [number, number], c: [number, number]) => w[0] >= c[0] - 1e-9 && w[1] <= c[1] + 1e-9;

  it("clamps to a non-aligned claim [21.2, 23.7] and recomputes the clipId from the clamped interval", () => {
    const c = claim({ window: [21.2, 23.7] });
    const r = selectCitation(c, TO_C, fill("A", 20, 25, IN_C), QS, sup());
    expect(r).toMatchObject({ ok: true, candidate: { camera: "A", window: [21.2, 23.7], clipId: "grid:s1:A:21.2-23.7" } });
    if (!r.ok) return;
    expect(r.candidate.basis.partialSlices).toBe(2); // 21.0-21.5 and 23.5-24.0 stick out
    expect(r.candidate.basis.slices).toBe(6);
  });

  it("every returned window is inside the claim, 1-4 s long and on observed slices", () => {
    const rows = fill("A", 0, 40, IN_C);
    for (const w of [[21.2, 23.7], [20.3, 30.8], [0.2, 2.4], [5.25, 9.75], [10, 12], [12.1, 16.1]] as [number, number][]) {
      const r = selectCitation(claim({ window: w }), TO_C, rows, QS, sup());
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(within(r.candidate.window, w)).toBe(true);
      const L = len(r.candidate.window);
      expect(L).toBeGreaterThanOrEqual(LIMITS.CLIP_MIN_S - 1e-9);
      expect(L).toBeLessThanOrEqual(LIMITS.CLIP_MAX_S + 1e-9);
      expect(r.candidate.clipId).toBe(gridClipId("s1", "A", r.candidate.window));
    }
  });

  it("drops claims whose observable intersection is shorter than 1 s", () => {
    expect(selectCitation(claim({ window: [21.2, 22.0] }), TO_C, fill("A", 20, 25, IN_C), QS, sup())).toMatchObject({ ok: false });
    expect(selectCitation(claim({ window: [21.6, 22.4] }), TO_C, fill("A", 20, 25, IN_C), QS, sup())).toMatchObject({ ok: false });
  });

  it("needs two consecutive slices fully inside the claim to show sustained support", () => {
    // [0.2, 1.4] is 1.2 s long but only the 0.5-1.0 slice lies fully inside it.
    expect(selectCitation(claim({ window: [0.2, 1.4] }), TO_C, fill("A", 0, 5, IN_C), QS, sup())).toMatchObject({ ok: false });
  });

  it("accepts a claim of exactly 1 s", () => {
    expect(selectCitation(claim({ window: [21, 22] }), TO_C, fill("A", 20, 25, IN_C), QS, sup())).toMatchObject({
      ok: true,
      candidate: { window: [21, 22] },
    });
  });

  it("support seen only in a partial edge slice does not count", () => {
    // Claimed state only in 23.0-24.0; the 23.5 slice is partial for [21.2, 23.7], leaving no full supporting pair.
    const rows = [...fill("A", 20, 23, { mugC: 0.5, mugB: 0.05 }), ...fill("A", 23, 25, IN_C)];
    const c = claim({ window: [21.2, 23.7] });
    expect(evidenceForTarget(c, TO_C, rows, QS)[0]!.supports!).toBeGreaterThanOrEqual(THRESHOLDS.CLEAR);
    expect(selectCitation(c, TO_C, rows, QS, sup())).toMatchObject({ ok: false });
  });

  it("contradiction must hold in every touching slice, partial ones included", () => {
    const c = claim({ window: [21.2, 23.7] });
    expect(selectCitation(c, TO_C, fill("A", 20, 25, IN_B), QS, con())).toMatchObject({ ok: true, candidate: { window: [21.2, 23.7] } });
    const weakEdge = [...fill("A", 20, 21.5, { mugC: 0.5, mugB: 0.5 }), ...fill("A", 21.5, 25, IN_B)];
    expect(selectCitation(c, TO_C, weakEdge, QS, con())).toMatchObject({ ok: false });
  });

  it("stays inside the scene duration as well as the claim", () => {
    const r = selectCitation(claim({ window: [21.2, 23.7] }), TO_C, fill("A", 20, 25, IN_C), QS, sup({ durationS: 23 }));
    expect(r).toMatchObject({ ok: true, candidate: { window: [21.2, 23] } });
  });

  it("insufficient observed coverage inside the claim gives no citation", () => {
    const rows = [...fill("A", 21, 21.5, IN_C), ...fill("A", 23.5, 24, IN_C)];
    expect(selectCitation(claim({ window: [21.2, 23.7] }), TO_C, rows, QS, sup())).toMatchObject({ ok: false });
  });

  it("an occlusion leaving under 1 s of usable view inside the claim gives no citation", () => {
    const rows = [...fill("A", 20, 22, IN_C), ...fill("A", 22, 24, IN_C, 0.2)];
    expect(selectCitation(claim({ window: [21.2, 23.7] }), TO_C, rows, QS, sup())).toMatchObject({ ok: false });
  });

  it("respects allowed cameras on non-aligned claims", () => {
    const rows = [...fill("A", 20, 25, IN_C), ...fill("B", 20, 25, IN_C)];
    expect(selectCitation(claim({ window: [21.2, 23.7] }), TO_C, rows, QS, sup({ allowedCameras: ["B"] }))).toMatchObject({
      ok: true,
      candidate: { camera: "B", window: [21.2, 23.7] },
    });
  });

  it("does not change the evidence or the verdict inputs", () => {
    const c = claim({ window: [21.2, 23.7] });
    const rows = fill("A", 20, 25, IN_C);
    const before = JSON.stringify(evidenceForTarget(c, TO_C, rows, QS));
    selectCitation(c, TO_C, rows, QS, sup());
    expect(JSON.stringify(evidenceForTarget(c, TO_C, rows, QS))).toBe(before);
  });
});
