// OWNER: Dev 1.
import { describe, expect, it } from "vitest";
import type { GridRow } from "@/lib/types";
import { auroc, ece, joinWithTruth, reliability, scoreKillTestA, type Labeled } from "@/lib/perception/calibration";
import type { SdgTruthFile } from "@/lib/capture/sdgWarehouse";

const pairs = (ps: number[], ys: (0 | 1)[]) => ps.map((p, i) => ({ p, y: ys[i]! }));

describe("ece", () => {
  it("is 0 when each bin's mean probability equals its hit rate", () => {
    expect(ece(pairs([0.25, 0.25, 0.25, 0.25], [1, 0, 0, 0]))).toBeCloseTo(0, 9);
  });
  it("weights each bin's |mean p - hit rate| by its share of samples", () => {
    // bin 0.9 (2 samples, both wrong: gap 0.9), bin 0.1 (2 samples, both right: gap 0.1) -> 0.5
    expect(ece(pairs([0.9, 0.9, 0.1, 0.1], [0, 0, 0, 0]))).toBeCloseTo(0.5, 9);
  });
  it("puts p = 1 in the top bin", () => {
    expect(ece(pairs([1, 1], [1, 1]))).toBeCloseTo(0, 9);
  });
});

describe("reliability", () => {
  it("lists non-empty bins with count, mean p and hit rate", () => {
    expect(reliability(pairs([0.05, 0.95, 0.91], [0, 1, 0]), 10)).toEqual([
      { lo: 0, hi: 0.1, n: 1, meanP: 0.05, hitRate: 0 },
      { lo: 0.9, hi: 1, n: 2, meanP: 0.93, hitRate: 0.5 },
    ]);
  });
});

describe("auroc", () => {
  it("is 1 for perfect ranking, 0 for reversed, 0.5 for ties", () => {
    expect(auroc(pairs([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]))).toBe(1);
    expect(auroc(pairs([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0]))).toBe(0);
    expect(auroc(pairs([0.5, 0.5, 0.5, 0.5], [1, 1, 0, 0]))).toBe(0.5);
  });
  it("counts each positive-negative pair (Mann-Whitney)", () => {
    // positives 0.6, 0.3; negatives 0.4, 0.1 -> pairs won: (0.6>0.4)(0.6>0.1)(0.3>0.1) = 3 of 4
    expect(auroc(pairs([0.6, 0.3, 0.4, 0.1], [1, 1, 0, 0]))).toBe(0.75);
  });
  it("is NaN with only one class", () => {
    expect(auroc(pairs([0.6, 0.3], [1, 1]))).toBeNaN();
  });
});

const truth: SdgTruthFile = {
  sceneId: "s1",
  runId: "r",
  views: { A: "ceiling_00", B: "eye_00", C: "ceiling_01", D: "eye_01" },
  summary: { outcome: "contact" },
  slices: [
    {
      t: 0,
      answers: {
        "forklift:state:near_worker": "no",
        "forklift:state:touching_worker": "no",
        "forklift:state:moving": "yes",
        "worker:state:dodging": "unclear",
      },
      cameras: {
        A: { alias: "ceiling_00", "worker:visible:yes": "yes", "forklift:visible:yes": "yes" },
        B: { alias: "eye_00", "worker:visible:yes": "no", "forklift:visible:yes": "yes" },
        C: { alias: "ceiling_01", "worker:visible:yes": "unclear", "forklift:visible:yes": "yes" },
        D: { alias: "eye_01", "worker:visible:yes": "yes", "forklift:visible:yes": "yes" },
      },
    },
  ],
};

const row = (camera: GridRow["camera"], questionId: string, pYes: number, t = 0): GridRow => ({
  sceneId: "s1", camera, t, questionId, pYes, pVisible: 0.9,
});

describe("joinWithTruth", () => {
  it("labels visibility rows per camera and skips unclear ones", () => {
    const got = joinWithTruth([row("A", "worker:visible:yes", 0.8), row("B", "worker:visible:yes", 0.3), row("C", "worker:visible:yes", 0.5)], truth);
    expect(got.map((l) => [l.camera, l.y, l.kind])).toEqual([["A", 1, "visible"], ["B", 0, "visible"]]);
  });
  it("scores a state question only on cameras that see the objects it is about", () => {
    const got = joinWithTruth(
      [
        row("A", "forklift:state:near_worker", 0.2), // both visible -> kept
        row("B", "forklift:state:near_worker", 0.2), // worker hidden -> dropped
        row("B", "forklift:state:moving", 0.9), // only needs the forklift -> kept
        row("A", "worker:state:dodging", 0.9), // unclear in the key -> dropped
      ],
      truth,
    );
    expect(got.map((l) => [l.camera, l.questionId, l.y])).toEqual([
      ["A", "forklift:state:near_worker", 0],
      ["B", "forklift:state:moving", 1],
    ]);
  });
  it("ignores rows for other scenes, unknown slices or questions the key does not cover", () => {
    const other = { ...row("A", "worker:visible:yes", 0.8), sceneId: "s2" };
    expect(joinWithTruth([other, row("A", "worker:visible:yes", 0.8, 5), row("A", "pedestrian:visible:yes", 0.8)], truth)).toEqual([]);
  });
});

describe("scoreKillTestA", () => {
  const L = (kind: Labeled["kind"], p: number, y: 0 | 1, questionId = "q"): Labeled => ({ sceneId: "s", camera: "A", t: 0, questionId, kind, p, y });
  it("passes with calibrated, well-ranked state answers and >= 90% visibility right", () => {
    const state = [...Array(10)].flatMap(() => [L("state", 0.95, 1), L("state", 0.05, 0)]);
    const vis = [...Array(10)].map((_, i) => L("visible", 0.9, i < 9 ? 1 : 0));
    const r = scoreKillTestA([...state, ...vis]);
    expect(r.state.ece).toBeLessThanOrEqual(0.1);
    expect(r.state.auroc).toBe(1);
    expect(r.visible.accuracy).toBe(0.9);
    expect(r.pass).toBe(true);
  });
  it("fails on underconfident but well-ranked answers (the 'rarely above 0.8' problem)", () => {
    const state = [...Array(10)].flatMap(() => [L("state", 0.65, 1), L("state", 0.35, 0)]);
    const r = scoreKillTestA(state);
    expect(r.state.auroc).toBe(1);
    expect(r.state.ece).toBeCloseTo(0.35, 9);
    expect(r.pass).toBe(false);
    expect(r.failures.join(" ")).toMatch(/calibration/);
  });
  it("breaks results down per question", () => {
    const r = scoreKillTestA([L("state", 0.9, 1, "a"), L("state", 0.1, 0, "a"), L("state", 0.4, 1, "b")]);
    expect(r.perQuestion.map((q) => [q.questionId, q.n])).toEqual([["a", 2], ["b", 1]]);
  });
});

describe("Platt calibration", () => {
  it("fitPlatt finds a monotone curve that makes underconfident answers confident", async () => {
    const { fitPlatt, applyPlatt } = await import("@/lib/perception/calibration");
    // well ranked but squeezed into 0.35-0.65: true yes ~0.6, true no ~0.4
    const data = [...Array(50)].flatMap((_, i) => [{ p: 0.55 + (i % 10) / 100, y: 1 as const }, { p: 0.35 + (i % 10) / 100, y: 0 as const }]);
    const m = fitPlatt(data);
    expect(m.a).toBeGreaterThan(1);
    expect(applyPlatt(0.62, m)).toBeGreaterThan(0.85);
    expect(applyPlatt(0.38, m)).toBeLessThan(0.15);
    expect(applyPlatt(0.5, m)).toBeGreaterThan(applyPlatt(0.49, m)); // keeps the order
  });

  it("is the identity when one class is missing or there is too little data", async () => {
    const { fitPlatt, applyPlatt } = await import("@/lib/perception/calibration");
    const m = fitPlatt([{ p: 0.3, y: 1 }, { p: 0.6, y: 1 }]);
    expect(applyPlatt(0.3, m)).toBeCloseTo(0.3, 9);
    expect(m.n).toBe(2);
  });

  it("stays the identity on lopsided data, so it never just learns 'usually yes'", async () => {
    const { fitPlatt, MIN_MINORITY_SHARE } = await import("@/lib/perception/calibration");
    expect(MIN_MINORITY_SHARE).toBe(0.2);
    // 90% yes: a curve would mostly learn the base rate (e.g. "the forklift is always moving")
    const skewed: { p: number; y: 0 | 1 }[] = [
      ...[...Array(90)].map((_, i) => ({ p: 0.4 + (i % 5) / 100, y: 1 as const })),
      ...[...Array(10)].map(() => ({ p: 0.3, y: 0 as const })),
    ];
    expect(fitPlatt(skewed)).toMatchObject({ a: 1, b: 0 });
  });

  it("clamps extreme inputs instead of returning NaN", async () => {
    const { fitPlatt, applyPlatt } = await import("@/lib/perception/calibration");
    const m = fitPlatt([...Array(40)].flatMap(() => [{ p: 0, y: 0 as const }, { p: 1, y: 1 as const }]));
    expect(Number.isFinite(applyPlatt(0, m))).toBe(true);
    expect(Number.isFinite(applyPlatt(1, m))).toBe(true);
  });

  it("fitPerQuestion fits one curve per question id", async () => {
    const { fitPerQuestion } = await import("@/lib/perception/calibration");
    const L = (questionId: string, p: number, y: 0 | 1): Labeled => ({ sceneId: "s", camera: "A", t: 0, questionId, kind: "state", p, y });
    const models = fitPerQuestion([...Array(30)].flatMap(() => [L("a", 0.6, 1), L("a", 0.4, 0), L("b", 0.2, 0)]));
    expect(Object.keys(models).sort()).toEqual(["a", "b"]);
    expect(models.a!.a).toBeGreaterThan(1);
    expect(models.b).toMatchObject({ a: 1, b: 0 }); // one class only
  });

  it("leaveOneSceneOut calibrates each scene with curves fitted on the other scenes only", async () => {
    const { leaveOneSceneOut } = await import("@/lib/perception/calibration");
    const L = (sceneId: string, p: number, y: 0 | 1): Labeled => ({ sceneId, camera: "A", t: 0, questionId: "q", kind: "state", p, y });
    const mk = (s: string) => [...Array(20)].flatMap(() => [L(s, 0.6, 1), L(s, 0.4, 0)]);
    const out = leaveOneSceneOut([...mk("s1"), ...mk("s2"), ...mk("s3")]);
    expect(out).toHaveLength(120);
    const yes = out.filter((l) => l.y === 1).map((l) => l.p);
    expect(Math.min(...yes)).toBeGreaterThan(0.8);
    // a scene alone has nothing to learn from: identity
    expect(leaveOneSceneOut(mk("solo")).every((l) => l.p === 0.6 || l.p === 0.4)).toBe(true);
  });
});
