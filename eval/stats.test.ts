// OWNER: Dev 4. Wilson intervals and the safety-first metrics the report is built from.
import { describe, expect, it } from "vitest";
import {
  type ClaimEval,
  claimAccuracy,
  falseClaimRecall,
  falseContradictionRate,
  labelerAgreement,
  byOcclusion,
  wilson,
} from "./stats";

describe("wilson", () => {
  it("matches known 95% intervals", () => {
    const a = wilson(0, 10);
    expect(a.rate).toBe(0);
    expect(a.low).toBeCloseTo(0, 3);
    expect(a.high).toBeCloseTo(0.278, 2);

    const b = wilson(5, 10);
    expect(b.rate).toBe(0.5);
    expect(b.low).toBeCloseTo(0.237, 2);
    expect(b.high).toBeCloseTo(0.763, 2);
  });

  it("stays inside [0,1] and brackets the point estimate", () => {
    for (let n = 1; n <= 50; n++) {
      for (let k = 0; k <= n; k++) {
        const r = wilson(k, n);
        expect(r.low).toBeGreaterThanOrEqual(0);
        expect(r.high).toBeLessThanOrEqual(1);
        expect(r.low).toBeLessThanOrEqual(r.rate);
        expect(r.rate).toBeLessThanOrEqual(r.high);
      }
    }
  });

  it("returns a safe zero shape when there are no observations", () => {
    expect(wilson(0, 0)).toEqual({ count: 0, total: 0, rate: 0, low: 0, high: 0 });
  });
});

const ev = (
  predicted: ClaimEval["predicted"],
  truth: ClaimEval["truth"],
  plannedOcclusion = false,
  i = 0,
): ClaimEval => ({ sceneId: "s", claimId: `c${i}`, predicted, truth, plannedOcclusion });

describe("metrics", () => {
  it("claim accuracy ignores Ambiguous truths", () => {
    const items = [
      ev("Supported", "Supported"),
      ev("Contradicted", "Contradicted"),
      ev("Supported", "Insufficient"),
      ev("Supported", "Ambiguous"),
    ];
    const m = claimAccuracy(items);
    expect(m.total).toBe(3);
    expect(m.count).toBe(2);
  });

  it("false-contradiction rate counts safe-label violations only", () => {
    const items = [
      ev("Contradicted", "Supported"), // violation: a true claim called Contradicted
      ev("Contradicted", "Insufficient"), // violation: an unseeable claim called Contradicted
      ev("Supported", "Supported"), // fine
      ev("Contradicted", "Contradicted"), // correct, not in denominator
      ev("Supported", "Ambiguous"), // excluded
    ];
    const m = falseContradictionRate(items);
    expect(m.total).toBe(3); // Supported, Insufficient, Supported truths
    expect(m.count).toBe(2);
  });

  it("false-claim recall is over truly-false claims", () => {
    const items = [
      ev("Contradicted", "Contradicted"),
      ev("Insufficient", "Contradicted"),
      ev("Supported", "Supported"),
    ];
    const m = falseClaimRecall(items);
    expect(m.total).toBe(2);
    expect(m.count).toBe(1);
  });

  it("labeler agreement is the fraction of matching pairs", () => {
    const m = labelerAgreement([
      { a: "Supported", b: "Supported" },
      { a: "Contradicted", b: "Contradicted" },
      { a: "Supported", b: "Insufficient" },
    ]);
    expect(m.total).toBe(3);
    expect(m.count).toBe(2);
    expect(m.rate).toBeCloseTo(2 / 3, 5);
  });

  it("splits items into natural vs planned occlusion", () => {
    const { natural, planned } = byOcclusion([
      ev("Supported", "Supported", false),
      ev("Supported", "Supported", true),
      ev("Supported", "Supported", true),
    ]);
    expect(natural).toHaveLength(1);
    expect(planned).toHaveLength(2);
  });
});

describe("accuracyByLabel", () => {
  it("scores each true label separately and ignores Ambiguous", async () => {
    const { accuracyByLabel } = await import("./stats");
    const mk = (predicted: "Supported" | "Contradicted" | "Insufficient", truth: "Supported" | "Contradicted" | "Insufficient" | "Ambiguous") => ({
      sceneId: "s",
      claimId: `${predicted}-${truth}-${Math.random()}`,
      predicted,
      truth,
    });
    const r = accuracyByLabel([
      mk("Supported", "Supported"),
      mk("Insufficient", "Supported"),
      mk("Contradicted", "Contradicted"),
      mk("Contradicted", "Ambiguous"),
    ]);
    expect(r.Supported.count).toBe(1);
    expect(r.Supported.total).toBe(2);
    expect(r.Contradicted.rate).toBe(1);
    expect(r.Insufficient.total).toBe(0);
  });
});
