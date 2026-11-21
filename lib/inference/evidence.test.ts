// OWNER: Dev 2. Tests for per-camera evidence extraction from the grid.
import { describe, expect, it } from "vitest";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { evidenceFor } from "@/lib/inference/evidence";
import { verdict } from "@/lib/inference/verdict";
import type { Audit, CameraId, Claim, GridRow, Question } from "@/lib/types";

// ---------- fixtures ----------

const q = (id: string, entityId: string, predicate: Question["predicate"], value: string, text: string): Question => ({
  id,
  entityId,
  predicate,
  value,
  text,
});

const QS: Question[] = [
  q("mugB", "e1", "location", "B", "Is the red mug in zone B?"),
  q("mugC", "e1", "location", "C", "Is the red mug in zone C?"),
  q("mugSam", "e1", "heldBy", "sam", "Is Sam holding the red mug?"),
  q("mugAna", "e1", "heldBy", "ana", "Is Ana holding the red mug?"),
  q("boxOpen", "e2", "state", "open", "Is the blue box open?"),
  q("bmugC", "e3", "location", "C", "Is the blue mug in zone C?"),
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

/** Rows for one camera over [t0, t1) at SLICE_S steps, one row per question in `values`. */
function fill(
  camera: CameraId,
  t0: number,
  t1: number,
  values: Record<string, number>,
  pVisible = 0.95,
  sceneId = "s1",
): GridRow[] {
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries(values)) rows.push({ sceneId, camera, t, questionId, pYes, pVisible });
  return rows;
}

const IN_C = { mugC: 0.95, mugB: 0.05 };
const IN_B = { mugC: 0.03, mugB: 0.96 };

const audit = (supportScore: number | null, contradictScore: number | null): Audit => ({
  supportScore,
  contradictScore,
  clipId: "audit",
});
const supportAudit = audit(0.95, 0.02);
const contradictAudit = audit(0.02, 0.97);

const allNull = (e: { supports: number | null; contradicts: number | null }[]) =>
  e.every((x) => x.supports === null && x.contradicts === null);

// ---------- positive and negative evidence ----------

describe("evidenceFor: support and contradiction", () => {
  it("a camera seeing the claimed state gives strong support and weak contradiction", () => {
    const e = evidenceFor(claim(), fill("A", 10, 12, IN_C), QS);
    expect(e).toEqual([
      { camera: "A", window: [10, 12], visible: 0.95, supports: 0.95, contradicts: 0.05, clipId: "grid:s1:A:10-12", source: "initial" },
    ]);
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });

  it("a camera seeing an incompatible state throughout gives decisive contradiction", () => {
    const e = evidenceFor(claim(), fill("A", 10, 12, IN_B), QS);
    expect(e).toHaveLength(1);
    expect(e[0]!.supports).toBeCloseTo(0.03);
    expect(e[0]!.contradicts).toBeCloseTo(0.96);
    expect(verdict(e, claim(), contradictAudit)).toBe("Contradicted");
  });

  it("a low pYes alone is never a contradiction", () => {
    const e = evidenceFor(claim(), fill("A", 10, 12, { mugC: 0.01 }), QS);
    expect(e[0]!.supports).toBeCloseTo(0.01);
    expect(e[0]!.contradicts).toBeNull();
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("an end state reached mid-window supports the claim and does not contradict it", () => {
    const rows = [...fill("A", 10, 11, IN_B), ...fill("A", 11, 12, IN_C)];
    const e = evidenceFor(claim(), rows, QS);
    expect(e[0]!.supports).toBeCloseTo(0.95);
    expect(e[0]!.contradicts).toBeLessThan(0.1);
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });

  it("a single-frame spike neither supports nor decisively contradicts", () => {
    const rows = [...fill("A", 10, 11, IN_B), ...fill("A", 11, 11.5, IN_C), ...fill("A", 11.5, 12, IN_B)];
    const e = evidenceFor(claim(), rows, QS);
    expect(e[0]!.supports).toBeLessThan(THRESHOLDS.CLEAR);
    expect(e[0]!.contradicts).toBeLessThan(THRESHOLDS.DECISIVE);
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("a camera answering yes to both the claim and an alternative is not strong either way", () => {
    const e = evidenceFor(claim(), fill("A", 10, 12, { mugC: 0.95, mugB: 0.95 }), QS);
    expect(e[0]!.supports).toBeLessThan(THRESHOLDS.CLEAR);
    expect(e[0]!.contradicts).toBeLessThan(THRESHOLDS.CLEAR);
  });

  it("heldBy: 'picked up' grounds to the actor holding the object", () => {
    const c = claim({ text: "Sam picked up the red mug", action: "picked up" });
    expect(evidenceFor(c, fill("A", 10, 12, { mugSam: 0.95, mugAna: 0.04 }), QS)[0]!.supports).toBeCloseTo(0.95);
    const e = evidenceFor(c, fill("A", 10, 12, { mugSam: 0.03, mugAna: 0.96 }), QS);
    expect(e[0]!.contradicts).toBeCloseTo(0.96);
    expect(verdict(e, c, contradictAudit)).toBe("Contradicted");
  });

  it("heldBy: 'handed ... to Ana' grounds to the recipient, not the actor", () => {
    const c = claim({ text: "Sam handed the red mug to Ana", action: "handed" });
    const e = evidenceFor(c, fill("A", 10, 12, { mugSam: 0.03, mugAna: 0.97 }), QS);
    expect(e[0]!.supports).toBeCloseTo(0.97);
    expect(verdict(e, c, supportAudit)).toBe("Supported");
  });

  it("state: supported when seen, never contradicted (state values are not known to be exclusive)", () => {
    const c = claim({ text: "Lee opened the blue box", actor: "Lee", object: "blue box", action: "opened" });
    expect(evidenceFor(c, fill("A", 10, 12, { boxOpen: 0.95 }), QS)[0]!.supports).toBeCloseTo(0.95);
    const e = evidenceFor(c, fill("A", 10, 12, { boxOpen: 0.01 }), QS);
    expect(e[0]!.contradicts).toBeNull();
    expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
  });

  it("vague-time claim seen in full by one camera can be Contradicted", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });
    expect(verdict(evidenceFor(c, fill("A", 0, 12, IN_B), QS), c, contradictAudit)).toBe("Contradicted");
  });
});

// ---------- per camera ----------

describe("evidenceFor: per camera", () => {
  it("keeps one record per camera and never averages them", () => {
    const rows = [...fill("A", 10, 12, { mugC: 0.79, mugB: 0.05 }), ...fill("B", 10, 12, { mugC: 0.78, mugB: 0.05 })];
    const e = evidenceFor(claim(), rows, QS);
    expect(e.map((x) => [x.camera, x.supports])).toEqual([
      ["A", 0.79],
      ["B", 0.78],
    ]);
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
  });

  it("two cameras that disagree yield Insufficient", () => {
    const rows = [...fill("A", 10, 12, IN_C), ...fill("B", 10, 12, IN_B)];
    const e = evidenceFor(claim(), rows, QS);
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("an occluded camera gives unusable evidence with no scores", () => {
    const e = evidenceFor(claim(), fill("B", 10, 12, IN_B, 0.2), QS);
    expect(e).toEqual([
      { camera: "B", window: [10, 12], visible: 0.2, supports: null, contradicts: null, clipId: "grid:s1:B:10-12", source: "initial" },
    ]);
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("an occlusion mid-window splits the camera into runs and blocks partial contradictions", () => {
    const rows = [...fill("A", 10, 11, IN_B), ...fill("A", 11, 11.5, IN_B, 0.3), ...fill("A", 11.5, 12, IN_B)];
    const e = evidenceFor(claim(), rows, QS);
    expect(e.map((x) => x.window)).toEqual([
      [10, 11],
      [11, 11.5],
      [11.5, 12],
    ]);
    expect(e.every((x) => x.contradicts === null)).toBe(true);
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("a missing slice also splits a run", () => {
    const rows = [...fill("A", 10, 10.5, IN_C), ...fill("A", 11, 12, IN_C)];
    expect(evidenceFor(claim(), rows, QS).map((x) => x.window)).toEqual([
      [10, 10.5],
      [11, 12],
    ]);
  });

  it("orders records by camera, then time", () => {
    const rows = [...fill("C", 10, 12, IN_C), ...fill("A", 11, 12, IN_C), ...fill("A", 10, 10.5, IN_C)];
    expect(evidenceFor(claim(), rows, QS).map((x) => `${x.camera}${x.window[0]}`)).toEqual(["A10", "A11", "C10"]);
  });

  it("visibility of a run is its lowest visible slice", () => {
    const rows = [...fill("A", 10, 11, IN_C, 0.95), ...fill("A", 11, 12, IN_C, 0.7)];
    expect(evidenceFor(claim(), rows, QS)[0]!.visible).toBeCloseTo(0.7);
  });
});

// ---------- time ----------

describe("evidenceFor: temporal alignment", () => {
  it("uses only slices that overlap the claim window, with slice boundaries", () => {
    const e = evidenceFor(claim(), fill("A", 6, 16, IN_C), QS);
    expect(e.map((x) => x.window)).toEqual([[10, 12]]);
  });

  it("includes a slice that partly overlaps the window, without extending past it", () => {
    const e = evidenceFor(claim({ window: [10.2, 11.7] }), fill("A", 6, 16, IN_C), QS);
    expect(e.map((x) => x.window)).toEqual([[10, 12]]);
  });

  it("returns nothing when no rows fall in the window", () => {
    expect(evidenceFor(claim(), fill("A", 0, 9.5, IN_C), QS)).toEqual([]);
  });

  it("partial coverage still supports but cannot contradict", () => {
    const sup = evidenceFor(claim(), fill("A", 10, 11, IN_C), QS);
    expect(sup[0]!.window).toEqual([10, 11]);
    expect(sup[0]!.supports).toBeCloseTo(0.95);
    const con = evidenceFor(claim(), fill("A", 10, 11, IN_B), QS);
    expect(con[0]!.contradicts).toBeNull();
  });

  it("ignores rows from other scenes", () => {
    const rows = [...fill("A", 10, 12, IN_C), ...fill("B", 10, 12, IN_B, 0.95, "s2")];
    const e = evidenceFor(claim(), rows, QS);
    expect(e.map((x) => x.camera)).toEqual(["A"]);
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });
});

// ---------- grounding ----------

describe("evidenceFor: grounding", () => {
  const rows = [...fill("A", 10, 12, IN_B), ...fill("B", 10, 12, IN_B)];

  it("grounds the object by entity id", () => {
    expect(evidenceFor(claim({ object: "e1" }), rows, QS)[0]!.contradicts).toBeCloseTo(0.96);
  });

  it("grounds the object by a unique phrase in question text, ignoring articles and case", () => {
    expect(evidenceFor(claim({ object: "The Red Mug" }), rows, QS)[0]!.contradicts).toBeCloseTo(0.96);
  });

  const ungrounded: [string, Partial<Claim>, Question[]][] = [
    ["an unknown object", { object: "green kettle" }, QS],
    ["an ambiguous object (two mugs)", { object: "mug", text: "Sam put the mug in zone C" }, QS],
    ["a move with no target zone", { text: "Sam put the red mug down" }, QS],
    ["a target nobody asked about", { text: "Sam put the red mug in zone D" }, QS],
    ["two target zones", { text: "Sam put the red mug in zone C or in zone B" }, QS],
    ["no questions at all", {}, []],
    ["an unknown action and no single candidate", { action: "looked at", text: "Sam looked at the red mug" }, QS],
  ];

  it.each(ungrounded)("returns null-score, unusable evidence for %s", (_name, o, qs) => {
    const c = claim(o);
    const e = evidenceFor(c, rows, qs);
    expect(e.length).toBeGreaterThan(0);
    expect(allNull(e)).toBe(true);
    expect(e.every((x) => x.visible === 0)).toBe(true);
    expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
    expect(verdict(e, c, supportAudit)).toBe("Insufficient");
  });
});

// ---------- data quality ----------

describe("evidenceFor: duplicate and malformed rows", () => {
  it("identical duplicates do not change the evidence", () => {
    const rows = fill("A", 10, 12, IN_C);
    expect(evidenceFor(claim(), [...rows, ...rows, ...rows], QS)).toEqual(evidenceFor(claim(), rows, QS));
  });

  it("conflicting duplicates are dropped rather than picked", () => {
    const rows = [...fill("A", 10, 12, { mugC: 0.95 }), ...fill("A", 10, 12, { mugC: 0.99 })];
    expect(evidenceFor(claim(), rows, QS)).toEqual([]);
  });

  it("malformed rows are ignored", () => {
    const rows = [
      ...fill("A", 10, 12, { mugC: Number.NaN, mugB: 2 }),
      ...fill("B", 10, 12, IN_B, Number.NaN),
      { sceneId: "s1", camera: "C" as CameraId, t: -1, questionId: "mugB", pYes: 0.99, pVisible: 0.99 },
    ];
    expect(evidenceFor(claim(), rows, QS)).toEqual([]);
  });

  it("rows for questions not in the list are ignored", () => {
    const rows = [...fill("A", 10, 12, { mugC: 0.95 }), ...fill("A", 10, 12, { other: 0.99 })];
    const e = evidenceFor(claim(), rows, QS);
    expect(e).toHaveLength(1);
    expect(e[0]!.supports).toBeCloseTo(0.95);
  });

  it("does not mutate its inputs", () => {
    const rows = fill("A", 10, 12, IN_C);
    const c = claim();
    const snap = JSON.stringify([rows, c, QS]);
    evidenceFor(c, rows, QS);
    expect(JSON.stringify([rows, c, QS])).toBe(snap);
  });
});

describe("evidenceFor: provenance", () => {
  it("every record names its camera, window, initial source and a grid reference", () => {
    const rows = [...fill("A", 10, 12, IN_C), ...fill("D", 11, 12, IN_C, 0.4)];
    for (const x of evidenceFor(claim(), rows, QS)) {
      expect(x.source).toBe("initial");
      expect(x.clipId).toBe(`grid:s1:${x.camera}:${x.window[0]}-${x.window[1]}`);
    }
  });
});
