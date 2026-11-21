// OWNER: Dev 2. Tests for the synthetic grid generator.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { fakeGrid, type FakeGridOptions } from "@/lib/inference/fake-grid";
import type { Event, GridRow, Question } from "@/lib/types";

// ---------- fixtures ----------

const q = (id: string, entityId: string, predicate: Question["predicate"], value: string): Question => ({
  id,
  entityId,
  predicate,
  value,
  text: `${entityId} ${predicate} ${value}?`,
});

const QS: Question[] = [
  q("mugB", "e1", "location", "B"),
  q("mugC", "e1", "location", "C"),
  q("mugSam", "e1", "heldBy", "sam"),
  q("mugVis", "e1", "visible", "yes"),
  q("boxOpen", "e2", "state", "open"),
  q("ghostC", "e3", "location", "C"), // e3 has no truth events: always unknown
];

const ev = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});

const TRUTH: Event[] = [
  ev("e1", "unknown", "B", 0),
  ev("e1", "B", "C", 6),
  ev("e1", "none", "sam", 3),
  ev("e1", "sam", "none", 5),
  ev("e2", "closed", "open", 4),
];

const opts = (o: Partial<FakeGridOptions> = {}): FakeGridOptions => ({
  sceneId: "s1",
  cameras: ["A", "B", "C"],
  durationS: 10,
  truth: TRUTH,
  questions: QS,
  noise: 0,
  sharedErrorRate: 0,
  seed: 7,
  ...o,
});

const at = (rows: GridRow[], camera: string, questionId: string, t: number): GridRow => {
  const r = rows.find((x) => x.camera === camera && x.questionId === questionId && x.t === t);
  if (!r) throw new Error(`no row ${camera} ${questionId} ${t}`);
  return r;
};

const isTrue = (p: number) => p > 0.9;
const isFalse = (p: number) => p < 0.1;

// ---------- determinism ----------

describe("fakeGrid: determinism", () => {
  afterEach(() => vi.restoreAllMocks());

  it("same options and seed give identical rows", () => {
    const o = opts({ noise: 0.6, sharedErrorRate: 0.3 });
    expect(fakeGrid(o)).toEqual(fakeGrid(o));
  });

  it("different seeds give different noise", () => {
    const a = fakeGrid(opts({ noise: 0.6, seed: 1 }));
    const b = fakeGrid(opts({ noise: 0.6, seed: 2 }));
    expect(a.map((r) => r.pYes)).not.toEqual(b.map((r) => r.pYes));
  });

  it("never calls Math.random or reads the clock", () => {
    const rnd = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    fakeGrid(opts({ noise: 0.5, sharedErrorRate: 0.5 }));
    expect(rnd).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("omitting the seed is deterministic too", () => {
    const o = opts({ noise: 0.5, seed: undefined });
    expect(fakeGrid(o)).toEqual(fakeGrid(o));
  });
});

// ---------- structure ----------

describe("fakeGrid: structure", () => {
  it("covers every camera x question x slice in time, camera, question order", () => {
    const rows = fakeGrid(opts());
    const slices = 10 / LIMITS.SLICE_S;
    expect(rows).toHaveLength(3 * QS.length * slices);
    const expected: string[] = [];
    for (let i = 0; i < slices; i++)
      for (const c of ["A", "B", "C"]) for (const qq of QS) expected.push(`${i * LIMITS.SLICE_S}|${c}|${qq.id}`);
    expect(rows.map((r) => `${r.t}|${r.camera}|${r.questionId}`)).toEqual(expected);
    expect(rows.every((r) => r.sceneId === "s1")).toBe(true);
  });

  it("slices start at multiples of SLICE_S and stop before the duration", () => {
    const rows = fakeGrid(opts({ durationS: 3.2, truth: [] }));
    const ts = [...new Set(rows.map((r) => r.t))];
    expect(ts).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
  });

  it("returns [] for empty cameras, empty questions or zero duration", () => {
    expect(fakeGrid(opts({ cameras: [] }))).toEqual([]);
    expect(fakeGrid(opts({ questions: [], truth: [] }))).toEqual([]);
    expect(fakeGrid(opts({ durationS: 0, truth: [] }))).toEqual([]);
  });
});

// ---------- truth ----------

describe("fakeGrid: ground truth", () => {
  const rows = fakeGrid(opts());

  it("location: true where the entity is, false elsewhere, switching at the event", () => {
    expect(isTrue(at(rows, "A", "mugB", 0).pYes)).toBe(true);
    expect(isFalse(at(rows, "A", "mugC", 0).pYes)).toBe(true);
    expect(isTrue(at(rows, "A", "mugB", 5.5).pYes)).toBe(true);
    expect(isTrue(at(rows, "A", "mugC", 6).pYes)).toBe(true);
    expect(isFalse(at(rows, "A", "mugB", 6).pYes)).toBe(true);
  });

  it("heldBy follows its own event chain", () => {
    expect(isFalse(at(rows, "B", "mugSam", 2.5).pYes)).toBe(true);
    expect(isTrue(at(rows, "B", "mugSam", 3).pYes)).toBe(true);
    expect(isTrue(at(rows, "B", "mugSam", 4.5).pYes)).toBe(true);
    expect(isFalse(at(rows, "B", "mugSam", 5).pYes)).toBe(true);
  });

  it("state: the first event's 'from' establishes the state before it", () => {
    expect(isFalse(at(rows, "C", "boxOpen", 0).pYes)).toBe(true);
    expect(isTrue(at(rows, "C", "boxOpen", 4).pYes)).toBe(true);
  });

  it("visible: true for an unoccluded camera when the entity's zone is known", () => {
    expect(isTrue(at(rows, "A", "mugVis", 1).pYes)).toBe(true);
  });

  it("an entity with no truth events stays uncertain", () => {
    for (const r of rows.filter((x) => x.questionId === "ghostC")) expect(r.pYes).toBe(0.5);
  });

  it("an unknown 'from' leaves the time before the first event uncertain", () => {
    const r = fakeGrid(opts({ truth: [ev("e1", "unknown", "C", 3)], questions: [QS[1]!, QS[3]!] }));
    expect(at(r, "A", "mugC", 2.5).pYes).toBe(0.5);
    expect(at(r, "A", "mugVis", 2.5).pYes).toBe(0.5);
    expect(isTrue(at(r, "A", "mugC", 3).pYes)).toBe(true);
  });

  it("an event to 'unknown' makes the state uncertain again", () => {
    const r = fakeGrid(opts({ truth: [ev("e1", "unknown", "C", 0), ev("e1", "C", "unknown", 5)], questions: [QS[1]!] }));
    expect(isTrue(at(r, "A", "mugC", 4.5).pYes)).toBe(true);
    expect(at(r, "A", "mugC", 5).pYes).toBe(0.5);
  });

  it("a visible question asking 'no' is the negation", () => {
    const r = fakeGrid(opts({ questions: [q("mugHidden", "e1", "visible", "no")] }));
    expect(isFalse(at(r, "A", "mugHidden", 1).pYes)).toBe(true);
  });

  it("events whose values match no asked predicate are ignored", () => {
    const r = fakeGrid(opts({ truth: [...TRUTH, ev("e1", "dry", "wet", 2)] }));
    expect(r).toEqual(rows);
  });

  it("visibility is high everywhere without occlusion", () => {
    expect(rows.every((r) => r.pVisible >= THRESHOLDS.USABLE)).toBe(true);
  });
});

// ---------- noise ----------

describe("fakeGrid: noise", () => {
  const meanAbsErr = (noise: number) => {
    const clean = fakeGrid(opts({ durationS: 60, noise: 0 }));
    const noisy = fakeGrid(opts({ durationS: 60, noise }));
    return noisy.reduce((s, r, i) => s + Math.abs(r.pYes - clean[i]!.pYes), 0) / noisy.length;
  };

  it("noise 0 gives the clean targets exactly", () => {
    expect(meanAbsErr(0)).toBe(0);
  });

  it("more noise means larger deviation from the truth", () => {
    const low = meanAbsErr(0.2);
    const high = meanAbsErr(0.8);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low * 2);
  });

  it("keeps every probability finite and in [0, 1] across seeds and settings", () => {
    for (const seed of [1, 2, 3, 99, 12345])
      for (const noise of [0, 0.5, 1])
        for (const sharedErrorRate of [0, 0.5, 1]) {
          const rows = fakeGrid(
            opts({ seed, noise, sharedErrorRate, occluded: [{ camera: "B", window: [2, 5] }] }),
          );
          for (const r of rows) {
            expect(Number.isFinite(r.pYes) && r.pYes >= 0 && r.pYes <= 1).toBe(true);
            expect(Number.isFinite(r.pVisible) && r.pVisible >= 0 && r.pVisible <= 1).toBe(true);
          }
        }
  });
});

// ---------- shared errors ----------

describe("fakeGrid: shared correlated errors", () => {
  const known = (rows: GridRow[]) => rows.filter((r) => r.questionId === "mugB" || r.questionId === "mugC");
  const flipped = (o: Partial<FakeGridOptions>) => {
    const clean = fakeGrid(opts({ durationS: 200, ...o, sharedErrorRate: 0 }));
    const bad = fakeGrid(opts({ durationS: 200, ...o }));
    return bad.map((r, i) => isTrue(r.pYes) !== isTrue(clean[i]!.pYes));
  };

  it("rate 0 produces no errors", () => {
    expect(flipped({ sharedErrorRate: 0 }).some(Boolean)).toBe(false);
  });

  it("rate 1 flips every known answer on every unoccluded camera", () => {
    const rows = fakeGrid(opts({ sharedErrorRate: 1 }));
    expect(isFalse(at(rows, "A", "mugB", 0).pYes)).toBe(true);
    expect(isTrue(at(rows, "B", "mugC", 0).pYes)).toBe(true);
    for (const r of rows.filter((x) => x.questionId === "ghostC")) expect(r.pYes).toBe(0.5);
  });

  it("an error hits every camera at once for the same question and slice", () => {
    const rows = fakeGrid(opts({ durationS: 100, sharedErrorRate: 0.3 }));
    for (const r of known(rows)) {
      expect(at(rows, "B", r.questionId, r.t).pYes).toBe(r.pYes);
      expect(at(rows, "C", r.questionId, r.t).pYes).toBe(r.pYes);
    }
  });

  it("errors come in time blocks, not single isolated slices", () => {
    const rows = fakeGrid(opts({ durationS: 100, sharedErrorRate: 0.3, truth: [ev("e1", "unknown", "B", 0)] }));
    const series = rows.filter((r) => r.camera === "A" && r.questionId === "mugB").map((r) => isFalse(r.pYes));
    // Count runs of flipped slices; every run is at least one full 2 s block (4 slices).
    let run = 0;
    const runs: number[] = [];
    for (const f of [...series, false]) {
      if (f) run++;
      else if (run > 0) {
        runs.push(run);
        run = 0;
      }
    }
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((n) => n % 4 === 0)).toBe(true);
  });

  it("the error rate is roughly the configured fraction", () => {
    const f = flipped({ sharedErrorRate: 0.3, questions: [QS[0]!] });
    const frac = f.filter(Boolean).length / f.length;
    expect(frac).toBeGreaterThan(0.15);
    expect(frac).toBeLessThan(0.45);
  });

  it("shared errors differ by question", () => {
    const rows = fakeGrid(opts({ durationS: 200, sharedErrorRate: 0.3, truth: [ev("e1", "unknown", "B", 0)] }));
    const b = rows.filter((r) => r.camera === "A" && r.questionId === "mugB").map((r) => isFalse(r.pYes));
    const c = rows.filter((r) => r.camera === "A" && r.questionId === "mugC").map((r) => isTrue(r.pYes));
    expect(b).not.toEqual(c);
  });
});

// ---------- occlusion ----------

describe("fakeGrid: occlusion", () => {
  const occluded = [{ camera: "B" as const, window: [2, 4] as [number, number] }];
  const rows = fakeGrid(opts({ noise: 0.4, occluded }));
  const base = fakeGrid(opts({ noise: 0.4 }));

  it("lowers visibility below USABLE for the occluded camera and window only", () => {
    for (const r of rows.filter((x) => x.camera === "B")) {
      const inside = r.t + LIMITS.SLICE_S > 2 && r.t < 4;
      expect(r.pVisible < THRESHOLDS.USABLE).toBe(inside);
    }
  });

  it("leaves other cameras exactly as they would be without the occlusion", () => {
    expect(rows.filter((r) => r.camera !== "B")).toEqual(base.filter((r) => r.camera !== "B"));
  });

  it("occluded answers stay near 0.5, never strong evidence either way", () => {
    for (const r of rows.filter((x) => x.camera === "B" && x.t >= 2 && x.t < 4 && x.questionId !== "mugVis")) {
      expect(r.pYes).toBeGreaterThanOrEqual(0.35);
      expect(r.pYes).toBeLessThanOrEqual(0.65);
    }
  });

  it("an occluded camera answers 'is it visible?' with no", () => {
    const clean = fakeGrid(opts({ occluded }));
    expect(isFalse(at(clean, "B", "mugVis", 3).pYes)).toBe(true);
    expect(isTrue(at(clean, "A", "mugVis", 3).pYes)).toBe(true);
  });

  it("occluded cameras do not share the other cameras' errors", () => {
    const r = fakeGrid(opts({ sharedErrorRate: 1, occluded }));
    expect(isFalse(at(r, "A", "mugB", 3).pYes)).toBe(true);
    expect(at(r, "B", "mugB", 3).pYes).toBeGreaterThanOrEqual(0.35);
  });
});

// ---------- validation ----------

describe("fakeGrid: validation", () => {
  const bad: [string, Partial<FakeGridOptions>][] = [
    ["empty sceneId", { sceneId: "" }],
    ["negative duration", { durationS: -1 }],
    ["NaN duration", { durationS: Number.NaN }],
    ["infinite duration", { durationS: Number.POSITIVE_INFINITY }],
    ["noise above 1", { noise: 1.5 }],
    ["NaN noise", { noise: Number.NaN }],
    ["negative shared error rate", { sharedErrorRate: -0.1 }],
    ["non-finite seed", { seed: Number.NaN }],
    ["duplicate cameras", { cameras: ["A", "A"] }],
    ["unknown camera", { cameras: ["A", "Z" as never] }],
    ["missing question id", { questions: [q("", "e1", "location", "B")] }],
    ["missing entity id", { questions: [q("x", "", "location", "B")] }],
    ["duplicate question ids", { questions: [QS[0]!, { ...QS[1]!, id: "mugB" }] }],
    ["event after the duration", { truth: [ev("e1", "B", "C", 11)] }],
    ["event before zero", { truth: [ev("e1", "B", "C", -1)] }],
    ["non-finite event time", { truth: [ev("e1", "B", "C", Number.NaN)] }],
    ["event with no entity", { truth: [ev("", "B", "C", 1)] }],
    ["event that changes nothing", { truth: [ev("e1", "B", "B", 1)] }],
    ["broken chain", { truth: [ev("e1", "unknown", "B", 0), ev("e1", "C", "D", 3)] }],
    ["two events at the same time", { truth: [ev("e1", "B", "C", 3), ev("e1", "C", "D", 3)] }],
    ["ambiguous predicate", { questions: [QS[0]!, q("odd", "e1", "state", "B")], truth: [ev("e1", "B", "C", 2)] }],
    ["occlusion of a camera not in the scene", { occluded: [{ camera: "D", window: [1, 2] }] }],
    ["reversed occlusion window", { occluded: [{ camera: "A", window: [3, 1] }] }],
    ["non-finite occlusion window", { occluded: [{ camera: "A", window: [0, Number.NaN] }] }],
  ];

  it.each(bad)("throws on %s", (_name, o) => {
    expect(() => fakeGrid(opts(o))).toThrow(/fakeGrid/);
  });

  it("accepts events in any input order", () => {
    const shuffled = [...TRUTH].reverse();
    expect(fakeGrid(opts({ truth: shuffled }))).toEqual(fakeGrid(opts()));
  });

  it("does not mutate its options", () => {
    const o = opts({ noise: 0.3, occluded: [{ camera: "A", window: [1, 2] }] });
    const snap = JSON.stringify(o);
    fakeGrid(o);
    expect(JSON.stringify(o)).toBe(snap);
  });
});
