// OWNER: Dev 2. Tests for evidenceForTarget(): evidence for an explicitly resolved question, and
// regression checks that evidenceFor() behaves exactly as before.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import { evidenceFor, evidenceForTarget, gridClipId, targetSlices, type EvidenceTarget } from "@/lib/inference/evidence";
import type { CameraId, Claim, GridRow, Question } from "@/lib/types";

const q = (id: string, entityId: string, predicate: Question["predicate"], value: string, text = id): Question => ({
  id,
  entityId,
  predicate,
  value,
  text,
});
const QS: Question[] = [
  q("mugB", "e1", "location", "B", "Is the red mug in zone B?"),
  q("mugC", "e1", "location", "C", "Is the red mug in zone C?"),
  q("mugP1", "e1", "heldBy", "person_1"),
  q("mugNone", "e1", "heldBy", "none"),
  q("boxOpen", "e2", "state", "open"),
  q("boxB", "e2", "location", "B"),
  q("mugVis", "e1", "visible", "yes"),
];
const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "c1",
  sceneId: "s1",
  text: "Sam put the red mug in zone C",
  actor: "Sam",
  object: "red mug",
  action: "put",
  window: [10, 12],
  timeIsPrecise: true,
  ...o,
});
function fill(camera: CameraId, t0: number, t1: number, values: Record<string, number>, pVisible = 0.95, sceneId = "s1"): GridRow[] {
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries(values)) rows.push({ sceneId, camera, t, questionId, pYes, pVisible });
  return rows;
}
const IN_C = { mugC: 0.95, mugB: 0.05 };
const IN_B = { mugC: 0.03, mugB: 0.96 };
const TO_C: EvidenceTarget = { questionId: "mugC", alternativeIds: ["mugB"] };

describe("evidenceForTarget", () => {
  it("matches evidenceFor() exactly when given the target evidenceFor would ground", () => {
    for (const rows of [fill("A", 10, 12, IN_C), fill("A", 10, 12, IN_B), [...fill("A", 10, 11, IN_B), ...fill("A", 11, 12, IN_C, 0.3)]]) {
      expect(evidenceForTarget(claim(), TO_C, rows, QS)).toEqual(evidenceFor(claim(), rows, QS));
    }
  });

  it("uses only the target, never Claim.object/actor/action, to choose questions", () => {
    const odd = claim({ object: "teapot", actor: "nobody", action: "looked at", text: "unrelated" });
    const e = evidenceForTarget(odd, TO_C, fill("A", 10, 12, IN_C), QS);
    expect(e[0]!.supports).toBeCloseTo(0.95);
    expect(evidenceFor(odd, fill("A", 10, 12, IN_C), QS).every((x) => x.supports === null)).toBe(true);
  });

  it("grounds heldBy to a person id the witness never said", () => {
    const t: EvidenceTarget = { questionId: "mugP1", alternativeIds: ["mugNone"] };
    const e = evidenceForTarget(claim({ action: "pick up" }), t, fill("A", 10, 12, { mugP1: 0.94, mugNone: 0.04 }), QS);
    expect(e[0]!.supports).toBeCloseTo(0.94);
    expect(e[0]!.contradicts).toBeCloseTo(0.04);
  });

  it("state targets take no alternatives and are never contradicted", () => {
    const e = evidenceForTarget(claim(), { questionId: "boxOpen", alternativeIds: [] }, fill("A", 10, 12, { boxOpen: 0.02 }), QS);
    expect(e[0]!.contradicts).toBeNull();
  });

  const invalid: [string, EvidenceTarget | null][] = [
    ["null target", null],
    ["unknown question", { questionId: "nope", alternativeIds: [] }],
    ["unknown alternative", { questionId: "mugC", alternativeIds: ["nope"] }],
    ["alternative from another entity", { questionId: "mugC", alternativeIds: ["boxB"] }],
    ["alternative with another predicate", { questionId: "mugC", alternativeIds: ["mugP1"] }],
    ["alternative equal to the target", { questionId: "mugC", alternativeIds: ["mugC"] }],
    ["duplicate alternatives", { questionId: "mugC", alternativeIds: ["mugB", "mugB"] }],
    ["state target with alternatives", { questionId: "boxOpen", alternativeIds: ["boxB"] }],
    ["visible predicate", { questionId: "mugVis", alternativeIds: [] }],
  ];

  it.each(invalid)("an invalid target (%s) gives null scores and visibility 0, never evidence", (_n, t) => {
    const rows = [...fill("A", 10, 12, IN_B), ...fill("B", 10, 12, IN_C)];
    const e = evidenceForTarget(claim(), t, rows, QS);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.supports === null && x.contradicts === null && x.visible === 0)).toBe(true);
  });

  it("ignores rows from other scenes", () => {
    const e = evidenceForTarget(claim(), TO_C, [...fill("A", 10, 12, IN_C), ...fill("B", 10, 12, IN_B, 0.95, "s2")], QS);
    expect(e.map((x) => x.camera)).toEqual(["A"]);
  });
});

describe("gridClipId", () => {
  it("formats the grid reference used by evidence records", () => {
    expect(gridClipId("s1", "A", [10, 12.5])).toBe("grid:s1:A:10-12.5");
    expect(evidenceFor(claim(), fill("A", 10, 12, IN_C), QS)[0]!.clipId).toBe(gridClipId("s1", "A", [10, 12]));
  });
});

describe("targetSlices", () => {
  it("returns the per-camera slice series evidence is built from, or null for an invalid target", () => {
    const s = targetSlices(claim(), TO_C, [...fill("A", 9, 13, IN_C), ...fill("B", 10, 11, IN_B, 0.2)], QS)!;
    expect([...s.keys()]).toEqual(["A", "B"]);
    expect(s.get("A")!.map((x) => x.t)).toEqual([10, 10.5, 11, 11.5]);
    expect(s.get("A")![0]).toMatchObject({ t: 10, visible: 0.95, usable: true });
    expect(s.get("A")![0]!.support).toBeCloseTo(0.95);
    expect(s.get("B")!.every((x) => !x.usable)).toBe(true);
    expect(targetSlices(claim(), null, fill("A", 10, 12, IN_C), QS)).toBeNull();
  });
});
