// OWNER: Dev 2. End to end with the real functions: fakeGrid -> evidenceFor -> verdict, and fakeGrid -> stateModel.
import { describe, expect, it } from "vitest";
import { evidenceFor } from "@/lib/inference/evidence";
import { fakeGrid, type FakeGridOptions } from "@/lib/inference/fake-grid";
import { eventF1 } from "@/lib/inference/metrics";
import { stateModel } from "@/lib/inference/state";
import { verdict } from "@/lib/inference/verdict";
import type { Audit, Claim, Event, Question } from "@/lib/types";

const loc = (zone: string): Question => ({
  id: `mug-${zone}`,
  entityId: "e1",
  predicate: "location",
  value: zone,
  text: `Is the red mug in zone ${zone}?`,
});
const QS: Question[] = [
  loc("B"),
  loc("C"),
  loc("D"),
  { id: "mug-sam", entityId: "e1", predicate: "heldBy", value: "sam", text: "Is Sam holding the red mug?" },
  { id: "mug-ana", entityId: "e1", predicate: "heldBy", value: "ana", text: "Is Ana holding the red mug?" },
  { id: "kettle-C", entityId: "e9", predicate: "location", value: "C", text: "Is the kettle in zone C?" },
];

const ev = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});

// The mug starts in B, Sam picks it up at 4, puts it down in C at 6; later it moves to D at 16.
const TRUTH: Event[] = [
  ev("e1", "unknown", "B", 0),
  ev("e1", "none", "sam", 4),
  ev("e1", "sam", "none", 6),
  ev("e1", "B", "C", 6),
  ev("e1", "C", "D", 16),
];

const grid = (o: Partial<FakeGridOptions> = {}) =>
  fakeGrid({
    sceneId: "s1",
    cameras: ["A", "B", "C"],
    durationS: 24,
    truth: TRUTH,
    questions: QS,
    noise: 0.2,
    sharedErrorRate: 0,
    seed: 11,
    ...o,
  });

const claim = (o: Partial<Claim>): Claim => ({
  id: "c",
  sceneId: "s1",
  text: "",
  actor: "Sam",
  object: "red mug",
  action: "put",
  window: [5, 9],
  timeIsPrecise: true,
  ...o,
});

// Audit fixtures stand in for Decision 1 on the cited clip.
const supportAudit: Audit = { supportScore: 0.94, contradictScore: 0.03, clipId: "audit" };
const contradictAudit: Audit = { supportScore: 0.03, contradictScore: 0.96, clipId: "audit" };

const run = (c: Claim, a: Audit, o: Partial<FakeGridOptions> = {}) => verdict(evidenceFor(c, grid(o), QS), c, a);

describe("pipeline: fakeGrid -> evidenceFor -> verdict", () => {
  const trueClaim = claim({ text: "Sam put the red mug in zone C" });
  const falseClaim = claim({ text: "Sam put the red mug in zone D" });
  const heldClaim = claim({ text: "Sam picked up the red mug", action: "picked up", window: [3.5, 6] });
  // Window inside Sam's holding period, so an alternative holder (Sam) is visible throughout.
  const wrongHolder = claim({ text: "Sam handed the red mug to Ana", action: "handed", window: [4, 6] });

  it("a wrong recipient over a window where nobody holds it for a slice stays Insufficient", () => {
    const c = claim({ text: "Sam handed the red mug to Ana", action: "handed", window: [3.5, 6] });
    expect(run(c, contradictAudit)).toBe("Insufficient");
  });

  it("a true claim is Supported", () => {
    expect(run(trueClaim, supportAudit)).toBe("Supported");
  });

  it("a false claim is Contradicted when cameras see the mug elsewhere throughout", () => {
    expect(run(falseClaim, contradictAudit)).toBe("Contradicted");
  });

  it("a true heldBy claim is Supported and a wrong recipient is Contradicted", () => {
    expect(run(heldClaim, supportAudit)).toBe("Supported");
    expect(run(wrongHolder, contradictAudit)).toBe("Contradicted");
  });

  it("a true claim is never Contradicted, even with a contradicting audit", () => {
    expect(run(trueClaim, contradictAudit)).toBe("Insufficient");
  });

  it("a vague-time false claim needs full coverage: one occluded camera is fine, all occluded is not", () => {
    const vague = claim({ text: "Sam put the red mug in zone D", window: [6, 14], timeIsPrecise: false });
    expect(run(vague, contradictAudit, { occluded: [{ camera: "A", window: [8, 10] }] })).toBe("Contradicted");
    const blind = [
      { camera: "A" as const, window: [8, 10] as [number, number] },
      { camera: "B" as const, window: [8, 10] as [number, number] },
      { camera: "C" as const, window: [8, 10] as [number, number] },
    ];
    expect(run(vague, contradictAudit, { occluded: blind })).toBe("Insufficient");
  });

  it("occlusion of every camera can never produce Contradicted", () => {
    const all = (["A", "B", "C"] as const).map((camera) => ({ camera, window: [0, 24] as [number, number] }));
    expect(run(falseClaim, contradictAudit, { occluded: all })).toBe("Insufficient");
    expect(run(trueClaim, supportAudit, { occluded: all })).toBe("Insufficient");
  });

  it("an entity with unknown truth can never produce Contradicted", () => {
    const kettle = claim({ object: "kettle", text: "Sam put the kettle in zone C" });
    expect(run(kettle, contradictAudit)).toBe("Insufficient");
  });

  it("an ungrounded claim can never produce a label", () => {
    const c = claim({ object: "teapot", text: "Sam put the teapot in zone C" });
    expect(run(c, contradictAudit)).toBe("Insufficient");
    expect(run(c, supportAudit)).toBe("Insufficient");
  });

  it("holds across seeds and noise: no true claim is ever Contradicted", () => {
    for (let seed = 1; seed <= 20; seed++)
      for (const noise of [0, 0.3, 0.6]) {
        const o = { seed, noise, sharedErrorRate: 0.05 };
        expect(run(trueClaim, contradictAudit, o)).not.toBe("Contradicted");
        expect(run(heldClaim, contradictAudit, o)).not.toBe("Contradicted");
      }
  });
});

describe("pipeline: fakeGrid -> stateModel", () => {
  it("recovers the movement events with camera attribution", () => {
    const rows = grid({ occluded: [{ camera: "C", window: [4, 8] }] });
    const events = stateModel(rows, QS);
    const moves = TRUTH.filter((e) => e.from !== "unknown" && e.from !== "none" && e.to !== "none");
    expect(eventF1(events, moves).f1).toBe(1);
    const toC = events.find((e) => e.to === "C")!;
    expect(toC.cameras).toEqual(["A", "B"]);
    expect(toC.confidence).toBeGreaterThan(0.8);
    expect(toC.confidence).toBeLessThanOrEqual(1);
  });
});
