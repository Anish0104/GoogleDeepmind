// OWNER: Dev 2. Tests for zone tracking: location probabilities in, movement events out.
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config";
import { fakeGrid } from "@/lib/inference/fake-grid";
import { eventF1 } from "@/lib/inference/metrics";
import { stateModel } from "@/lib/inference/state";
import type { CameraId, Event, GridRow, Question, Zone } from "@/lib/types";

// ---------- fixtures ----------

const loc = (entityId: string, zone: Zone, name: string): Question => ({
  id: `${entityId}-${zone}`,
  entityId,
  predicate: "location",
  value: zone,
  text: `Is the ${name} in zone ${zone}?`,
});

const E1_ZONES: Zone[] = ["B", "C", "D"];
const E2_ZONES: Zone[] = ["B", "C"];
const QS: Question[] = [...E1_ZONES.map((z) => loc("e1", z, "red mug")), ...E2_ZONES.map((z) => loc("e2", z, "blue box"))];

/** Rows over [t0, t1) where `camera` sees `entityId` in `zone` (or nothing clear when zone is null). */
function seen(
  camera: CameraId,
  entityId: string,
  t0: number,
  t1: number,
  zone: Zone | null,
  { pVisible = 0.95, pTrue = 0.95, sceneId = "s1" } = {},
): GridRow[] {
  const zones = entityId === "e1" ? E1_ZONES : E2_ZONES;
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const z of zones)
      rows.push({
        sceneId,
        camera,
        t,
        questionId: `${entityId}-${z}`,
        pYes: zone === null ? 0.5 : z === zone ? pTrue : 0.04,
        pVisible,
      });
  return rows;
}

const both = (entityId: string, t0: number, t1: number, zone: Zone | null, o = {}) => [
  ...seen("A", entityId, t0, t1, zone, o),
  ...seen("B", entityId, t0, t1, zone, o),
];

const ev = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});

// ---------- basic tracking ----------

describe("stateModel: transitions", () => {
  it("a stationary object produces no events", () => {
    expect(stateModel(both("e1", 0, 20, "C"), QS)).toEqual([]);
  });

  it("a clean move produces one event at the first sampled slice in the new zone", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "C")];
    expect(stateModel(rows, QS)).toEqual([
      { entityId: "e1", from: "B", to: "C", t: 6, confidence: 0.95, cameras: ["A", "B"] },
    ]);
  });

  it("a single-frame spike is not an event", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 6.5, "C"), ...both("e1", 6.5, 12, "B")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("alternating jitter does not oscillate", () => {
    const rows: GridRow[] = both("e1", 0, 4, "B");
    for (let t = 4; t < 12; t += LIMITS.SLICE_S) rows.push(...both("e1", t, t + LIMITS.SLICE_S, (t * 2) % 2 === 0 ? "C" : "B"));
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("goes directly between zones without inventing intermediate events", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "D")];
    const events = stateModel(rows, QS);
    expect(events.map((e) => `${e.from}->${e.to}`)).toEqual(["B->D"]);
  });

  it("a series of moves produces one event each, in time order", () => {
    const rows = [...both("e1", 0, 4, "B"), ...both("e1", 4, 8, "C"), ...both("e1", 8, 12, "D")];
    expect(stateModel(rows, QS).map((e) => [e.from, e.to, e.t])).toEqual([
      ["B", "C", 4],
      ["C", "D", 8],
    ]);
  });

  it("tracks several entities independently", () => {
    const rows = [
      ...both("e1", 0, 6, "B"),
      ...both("e1", 6, 12, "C"),
      ...both("e2", 0, 3, "C"),
      ...both("e2", 3, 12, "B"),
    ];
    expect(stateModel(rows, QS).map((e) => [e.entityId, e.from, e.to, e.t])).toEqual([
      ["e2", "C", "B", 3],
      ["e1", "B", "C", 6],
    ]);
  });
});

// ---------- unknowns and occlusion ----------

describe("stateModel: unknown, occluded and conflicting", () => {
  it("an object first seen mid-scene has an unknown initial state and no event", () => {
    const rows = [...both("e1", 0, 3, null), ...both("e1", 3, 12, "C")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("a temporary occlusion with no move produces no event", () => {
    const rows = [...both("e1", 0, 5, "B"), ...both("e1", 5, 7, "B", { pVisible: 0.2 }), ...both("e1", 7, 12, "B")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("an occluded view showing a different zone is ignored", () => {
    const rows = [...both("e1", 0, 5, "B"), ...both("e1", 5, 8, "C", { pVisible: 0.3 }), ...both("e1", 8, 12, "B")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("a move hidden by a short occlusion is reported when the object reappears", () => {
    const rows = [...both("e1", 0, 5, "B"), ...both("e1", 5, 6.5, "B", { pVisible: 0.2 }), ...both("e1", 6.5, 12, "C")];
    expect(stateModel(rows, QS).map((e) => [e.from, e.to, e.t])).toEqual([["B", "C", 6.5]]);
  });

  it("a move hidden by a long gap is suppressed, not guessed", () => {
    const rows = [...both("e1", 0, 4, "B"), ...both("e1", 4, 8, "B", { pVisible: 0.2 }), ...both("e1", 8, 12, "C")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("cameras that disagree throughout produce no events", () => {
    const rows = [...seen("A", "e1", 0, 12, "B"), ...seen("B", "e1", 0, 12, "C")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("a move seen by only one of two usable cameras that disagree is not an event", () => {
    const rows = [...both("e1", 0, 6, "B"), ...seen("A", "e1", 6, 12, "C"), ...seen("B", "e1", 6, 12, "B")];
    expect(stateModel(rows, QS)).toEqual([]);
  });

  it("a camera with no clear answer neither votes nor blocks", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "C"), ...seen("C", "e1", 0, 12, null)];
    expect(stateModel(rows, QS)[0]!.cameras).toEqual(["A", "B"]);
  });

  it("only cameras that saw the new zone are credited", () => {
    const rows = [
      ...both("e1", 0, 6, "B"),
      ...both("e1", 6, 12, "C"),
      ...seen("C", "e1", 0, 6, "B"),
      ...seen("C", "e1", 6, 12, "C", { pVisible: 0.1 }),
    ];
    expect(stateModel(rows, QS)[0]!.cameras).toEqual(["A", "B"]);
  });

  it("confidence is the weakest observation behind the event, and stays in [0, 1]", () => {
    const rows = [...both("e1", 0, 6, "B"), ...seen("A", "e1", 6, 12, "C", { pTrue: 0.82 }), ...seen("B", "e1", 6, 12, "C")];
    const [e] = stateModel(rows, QS);
    expect(e!.confidence).toBeCloseTo(0.82);
    expect(e!.confidence).toBeGreaterThanOrEqual(0);
    expect(e!.confidence).toBeLessThanOrEqual(1);
  });

  it("moderate answers below CLEAR never make an event", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "C", { pTrue: 0.7 })];
    expect(stateModel(rows, QS)).toEqual([]);
  });
});

// ---------- inputs ----------

describe("stateModel: inputs", () => {
  it("returns [] for no rows or no location questions", () => {
    expect(stateModel([], QS)).toEqual([]);
    expect(stateModel(both("e1", 0, 12, "C"), [])).toEqual([]);
  });

  it("ignores non-location questions and non-zone location values", () => {
    const extra: Question[] = [
      { id: "held", entityId: "e1", predicate: "heldBy", value: "sam", text: "?" },
      { id: "shelf", entityId: "e1", predicate: "location", value: "shelf", text: "?" },
    ];
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "C")];
    const noise = rows.filter((r) => r.questionId === "e1-B").flatMap((r) => [
      { ...r, questionId: "held", pYes: 0.99 },
      { ...r, questionId: "shelf", pYes: 0.99 },
    ]);
    expect(stateModel([...rows, ...noise], [...QS, ...extra])).toEqual(stateModel(rows, QS));
  });

  it("duplicate rows do not change the result", () => {
    const rows = [...both("e1", 0, 6, "B"), ...both("e1", 6, 12, "C")];
    expect(stateModel([...rows, ...rows], QS)).toEqual(stateModel(rows, QS));
  });

  it("event times are sampled slice times", () => {
    const rows = fakeGrid({
      sceneId: "s1",
      cameras: ["A", "B"],
      durationS: 20,
      truth: [ev("e1", "unknown", "B", 0), ev("e1", "B", "C", 7.3)],
      questions: QS,
      noise: 0.2,
      sharedErrorRate: 0,
      seed: 3,
    });
    const times = new Set(rows.map((r) => r.t));
    const events = stateModel(rows, QS);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(times.has(e.t)).toBe(true);
  });

  it("rejects rows from more than one scene", () => {
    expect(() => stateModel([...both("e1", 0, 2, "B"), ...both("e1", 2, 4, "B", { sceneId: "s2" })], QS)).toThrow(
      /stateModel/,
    );
  });
});

// ---------- end to end on synthetic grids ----------

describe("stateModel: event F1 on synthetic grids", () => {
  const truth = [
    ev("e1", "unknown", "B", 0),
    ev("e1", "B", "C", 6),
    ev("e1", "C", "D", 14),
    ev("e2", "unknown", "C", 0),
    ev("e2", "C", "B", 9),
  ];
  const moves = truth.filter((e) => e.from !== "unknown");

  it.each([1, 2, 3, 4, 5])("reaches F1 >= 0.75 with moderate noise, shared errors and an occlusion (seed %i)", (seed) => {
    const rows = fakeGrid({
      sceneId: "s1",
      cameras: ["A", "B", "C"],
      durationS: 24,
      truth,
      questions: QS,
      noise: 0.3,
      sharedErrorRate: 0.02,
      occluded: [{ camera: "C", window: [5, 10] }],
      seed,
    });
    expect(eventF1(stateModel(rows, QS), moves).f1).toBeGreaterThanOrEqual(0.75);
  });

  it("is perfect on a clean grid", () => {
    const rows = fakeGrid({
      sceneId: "s1",
      cameras: ["A", "B"],
      durationS: 24,
      truth,
      questions: QS,
      noise: 0,
      sharedErrorRate: 0,
      seed: 1,
    });
    const events = stateModel(rows, QS);
    expect(eventF1(events, moves)).toEqual({ precision: 1, recall: 1, f1: 1, matched: 3 });
    expect(events.map((e) => e.t)).toEqual([6, 9, 14]);
  });

  it("a fully occluded scene produces no events at all", () => {
    const rows = fakeGrid({
      sceneId: "s1",
      cameras: ["A", "B"],
      durationS: 24,
      truth,
      questions: QS,
      noise: 0.3,
      sharedErrorRate: 0,
      occluded: [
        { camera: "A", window: [0, 24] },
        { camera: "B", window: [0, 24] },
      ],
      seed: 1,
    });
    expect(stateModel(rows, QS)).toEqual([]);
  });
});
