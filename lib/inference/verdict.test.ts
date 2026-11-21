// OWNER: Dev 2. One test per branch of the verdict rules in docs/DEV2-reasoning-core.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THRESHOLDS } from "@/lib/config";
import { enforceDowngradeOnly, isWeakSupport, verdict } from "@/lib/inference/verdict";
import type { Audit, CameraId, Claim, ClaimResult, Evidence, Verdict } from "@/lib/types";

const { USABLE, CLEAR, DECISIVE, WEAK_SUPPORT_MARGIN } = THRESHOLDS;

// ---------- typed fixtures ----------

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "c1",
    sceneId: "s1",
    text: "Sam put the red mug in zone C at about 12 s",
    actor: "Sam",
    object: "red mug",
    action: "place",
    window: [10, 14],
    timeIsPrecise: true,
    ...overrides,
  };
}

function ev(camera: CameraId, overrides: Partial<Evidence> = {}): Evidence {
  return {
    camera,
    window: [11, 13],
    visible: 0.95,
    supports: null,
    contradicts: null,
    clipId: `clip-${camera}`,
    source: "initial",
    ...overrides,
  };
}

const supportEv = (camera: CameraId, supports = 0.95, o: Partial<Evidence> = {}) =>
  ev(camera, { supports, contradicts: 0.02, ...o });
const contradictEv = (camera: CameraId, contradicts = 0.97, o: Partial<Evidence> = {}) =>
  ev(camera, { supports: 0.02, contradicts, ...o });

function audit(supportScore: number | null, contradictScore: number | null): Audit {
  return { supportScore, contradictScore, clipId: "audit-clip" };
}
const supportAudit = audit(0.95, 0.02);
const contradictAudit = audit(0.02, 0.97);

function result(v: Verdict, evidence: Evidence[], a: Audit | null, history: ClaimResult["history"] = []): ClaimResult {
  return { claimId: "c1", verdict: v, evidence, audit: a, history };
}

// ---------- verdict() ----------

describe("verdict: Supported", () => {
  it("strong support from one usable camera with a confirming audit", () => {
    expect(verdict([supportEv("A")], claim(), supportAudit)).toBe("Supported");
  });

  it("strong support from several cameras", () => {
    expect(verdict([supportEv("A"), supportEv("B", 0.88), ev("C")], claim(), supportAudit)).toBe("Supported");
  });

  it("support exactly at CLEAR, visibility exactly at USABLE, audit exactly at CLEAR", () => {
    const e = supportEv("A", CLEAR, { visible: USABLE });
    expect(verdict([e], claim(), audit(CLEAR, 0))).toBe("Supported");
  });

  it("support just below CLEAR is Insufficient", () => {
    expect(verdict([supportEv("A", CLEAR - 0.001)], claim(), supportAudit)).toBe("Insufficient");
  });

  it("audit just below CLEAR is Insufficient", () => {
    expect(verdict([supportEv("A")], claim(), audit(CLEAR - 0.001, 0))).toBe("Insufficient");
  });

  it("does not need full coverage for a vague-time claim", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 60] });
    expect(verdict([supportEv("A", 0.95, { window: [20, 22] })], c, supportAudit)).toBe("Supported");
  });

  it("accepts support found later by the investigator", () => {
    const e = [ev("A", { supports: 0.3 }), supportEv("B", 0.92, { source: "investigator" })];
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });
});

describe("verdict: Contradicted", () => {
  it("strong contradiction from one usable camera with a confirming audit", () => {
    expect(verdict([contradictEv("A")], claim(), contradictAudit)).toBe("Contradicted");
  });

  it("contradiction exactly at DECISIVE with audit exactly at DECISIVE", () => {
    const e = contradictEv("A", DECISIVE, { visible: USABLE });
    expect(verdict([e], claim(), audit(0, DECISIVE))).toBe("Contradicted");
  });

  it("contradiction just below DECISIVE is Insufficient", () => {
    expect(verdict([contradictEv("A", DECISIVE - 0.001)], claim(), contradictAudit)).toBe("Insufficient");
  });

  it("audit contradict score just below DECISIVE is Insufficient", () => {
    expect(verdict([contradictEv("A")], claim(), audit(0, DECISIVE - 0.001))).toBe("Insufficient");
  });

  it("vague-time claim with usable views covering the whole window", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });
    const e = [
      contradictEv("A", 0.97, { window: [0, 5] }),
      ev("B", { window: [5, 9], supports: 0.05, contradicts: 0.4 }),
      ev("C", { window: [8, 12], supports: 0.05 }),
    ];
    expect(verdict(e, c, contradictAudit)).toBe("Contradicted");
  });

  it("vague-time claim covered by evidence extending past both ends of the window", () => {
    const c = claim({ timeIsPrecise: false, window: [5, 10] });
    const e = [contradictEv("A", 0.97, { window: [0, 8] }), ev("B", { window: [7, 20] })];
    expect(verdict(e, c, contradictAudit)).toBe("Contradicted");
  });

  it("vague-time claim with a gap in usable coverage is Insufficient", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });
    const e = [contradictEv("A", 0.97, { window: [0, 5] }), ev("B", { window: [6, 12] })];
    expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
  });

  it("vague-time claim whose gap is only filled by an unusable view is Insufficient", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });
    const e = [
      contradictEv("A", 0.97, { window: [0, 5] }),
      ev("B", { window: [5, 7], visible: USABLE - 0.01 }),
      ev("C", { window: [7, 12] }),
    ];
    expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
  });

  it("vague-time claim missing the end of the window is Insufficient", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });
    expect(verdict([contradictEv("A", 0.97, { window: [0, 11] })], c, contradictAudit)).toBe("Insufficient");
  });

  describe("regression: windows cover the interval but visibility does not", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 12] });

    it("an occluded stretch inside full window coverage is Insufficient", () => {
      // Every second of [0, 12] has a row, but cam B is occluded during [5, 8].
      const e = [
        contradictEv("A", 0.97, { window: [0, 5] }),
        ev("B", { window: [5, 8], visible: 0.15, supports: 0.01, contradicts: 0.99 }),
        ev("C", { window: [8, 12] }),
      ];
      expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
    });

    it("a camera spanning the window while occluded does not count as coverage", () => {
      const e = [
        contradictEv("A", 0.97, { window: [0, 6] }),
        ev("B", { window: [0, 12], visible: USABLE - 0.01 }),
      ];
      expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
    });

    it("unknown visibility (NaN) inside the coverage is treated as a gap", () => {
      const e = [
        contradictEv("A", 0.97, { window: [0, 4] }),
        ev("B", { window: [4, 8], visible: Number.NaN }),
        ev("C", { window: [8, 12] }),
      ];
      expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
    });

    it("the same camera occluded mid-window leaves a gap even with rows on both sides", () => {
      const e = [
        contradictEv("A", 0.97, { window: [0, 4] }),
        ev("A", { window: [4, 6], visible: 0.3 }),
        ev("A", { window: [6, 12] }),
      ];
      expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
    });

    it("becomes Contradicted once another usable camera covers the occluded stretch", () => {
      const e = [
        contradictEv("A", 0.97, { window: [0, 5] }),
        ev("B", { window: [5, 8], visible: 0.15 }),
        ev("D", { window: [4.5, 8.5], visible: USABLE }),
        ev("C", { window: [8, 12] }),
      ];
      expect(verdict(e, c, contradictAudit)).toBe("Contradicted");
    });
  });

  it("precise-time claim does not need full coverage", () => {
    const c = claim({ timeIsPrecise: true, window: [0, 12] });
    expect(verdict([contradictEv("A", 0.97, { window: [4, 6] })], c, contradictAudit)).toBe("Contradicted");
  });
});

describe("verdict: Insufficient", () => {
  it("no evidence at all", () => {
    expect(verdict([], claim(), supportAudit)).toBe("Insufficient");
  });

  it("no audit", () => {
    expect(verdict([supportEv("A")], claim(), null)).toBe("Insufficient");
    expect(verdict([contradictEv("A")], claim(), null)).toBe("Insufficient");
  });

  it("audit with null scores", () => {
    expect(verdict([supportEv("A")], claim(), audit(null, null))).toBe("Insufficient");
    expect(verdict([contradictEv("A")], claim(), audit(null, null))).toBe("Insufficient");
  });

  it("strong camera support but the audit leans the other way", () => {
    expect(verdict([supportEv("A")], claim(), contradictAudit)).toBe("Insufficient");
  });

  it("audit confirms both support and contradiction", () => {
    expect(verdict([supportEv("A")], claim(), audit(0.95, 0.95))).toBe("Insufficient");
    expect(verdict([contradictEv("A")], claim(), audit(0.95, 0.95))).toBe("Insufficient");
  });

  it("strong support from a camera below USABLE visibility", () => {
    expect(verdict([supportEv("A", 0.99, { visible: USABLE - 0.001 })], claim(), supportAudit)).toBe("Insufficient");
  });

  it("strong contradiction from a camera below USABLE visibility", () => {
    expect(verdict([contradictEv("A", 0.99, { visible: 0.2 })], claim(), contradictAudit)).toBe("Insufficient");
  });

  it("usable cameras that saw nothing decisive (low scores never mean false)", () => {
    const e = [ev("A", { supports: 0.1, contradicts: 0.1 }), ev("B", { supports: 0.05, contradicts: 0.3 })];
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("very low support probability is not a contradiction", () => {
    expect(verdict([ev("A", { supports: 0.0, contradicts: null })], claim(), contradictAudit)).toBe("Insufficient");
  });

  it("evidence with null scores (camera unable to judge)", () => {
    expect(verdict([ev("A"), ev("B")], claim(), supportAudit)).toBe("Insufficient");
  });

  it("two usable cameras that disagree", () => {
    const e = [supportEv("A", 0.95), contradictEv("B", 0.97)];
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("a usable camera contradicting at CLEAR blocks Supported", () => {
    const e = [supportEv("A", 0.95), contradictEv("B", CLEAR)];
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
  });

  it("a usable camera supporting at CLEAR blocks Contradicted", () => {
    const e = [contradictEv("A", 0.97), supportEv("B", CLEAR)];
    expect(verdict(e, claim(), contradictAudit)).toBe("Insufficient");
  });

  it("weak disagreement below CLEAR does not block a decision", () => {
    expect(verdict([supportEv("A", 0.95), contradictEv("B", CLEAR - 0.001)], claim(), supportAudit)).toBe(
      "Supported",
    );
    expect(verdict([contradictEv("A", 0.97), supportEv("B", CLEAR - 0.001)], claim(), contradictAudit)).toBe(
      "Contradicted",
    );
  });

  it("disagreement from an unusable camera is ignored", () => {
    const e = [supportEv("A", 0.95), contradictEv("B", 0.99, { visible: 0.3 })];
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });

  it("never averages cameras: two moderate views do not add up to support", () => {
    const e = [supportEv("A", 0.7), supportEv("B", 0.75), supportEv("C", 0.79)];
    expect(verdict(e, claim(), supportAudit)).toBe("Insufficient");
  });

  it("never averages cameras: one strong view is not diluted by weak ones", () => {
    const e = [supportEv("A", 0.95), ev("B", { supports: 0.1 }), ev("C", { supports: 0.2 })];
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });

  it("non-finite scores are treated as missing", () => {
    expect(verdict([ev("A", { supports: Number.NaN })], claim(), supportAudit)).toBe("Insufficient");
    expect(verdict([supportEv("A", 0.95, { visible: Number.NaN })], claim(), supportAudit)).toBe("Insufficient");
    expect(verdict([supportEv("A")], claim(), audit(Number.NaN, 0))).toBe("Insufficient");
  });
});

describe("verdict: temporal window", () => {
  it("ignores strong support entirely outside the claim window", () => {
    expect(verdict([supportEv("A", 0.99, { window: [30, 32] })], claim(), supportAudit)).toBe("Insufficient");
  });

  it("ignores strong contradiction entirely outside the claim window", () => {
    expect(verdict([contradictEv("A", 0.99, { window: [0, 5] })], claim(), contradictAudit)).toBe("Insufficient");
  });

  it("ignores evidence that only touches the window edge", () => {
    expect(verdict([supportEv("A", 0.99, { window: [14, 16] })], claim(), supportAudit)).toBe("Insufficient");
  });

  it("counts evidence that partly overlaps the window", () => {
    expect(verdict([supportEv("A", 0.95, { window: [13, 16] })], claim(), supportAudit)).toBe("Supported");
  });

  it("an out-of-window contradiction does not block in-window support", () => {
    const e = [supportEv("A", 0.95), contradictEv("B", 0.99, { window: [40, 42] })];
    expect(verdict(e, claim(), supportAudit)).toBe("Supported");
  });

  it("out-of-window evidence does not fill a coverage gap", () => {
    const c = claim({ timeIsPrecise: false, window: [0, 10] });
    const e = [contradictEv("A", 0.97, { window: [0, 10 - 0.5] }), ev("B", { window: [10, 20] })];
    expect(verdict(e, c, contradictAudit)).toBe("Insufficient");
  });
});

describe("verdict: purity", () => {
  it("does not mutate its inputs", () => {
    const e = [supportEv("A"), contradictEv("B", 0.5)];
    const c = claim();
    const a = audit(0.9, 0.1);
    const snapshot = JSON.stringify([e, c, a]);
    verdict(e, c, a);
    expect(JSON.stringify([e, c, a])).toBe(snapshot);
  });
});

// ---------- enforceDowngradeOnly() ----------

describe("enforceDowngradeOnly", () => {
  const NOW = "2026-11-21T12:00:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("downgrades a wrong Contradicted label to Insufficient and logs it", () => {
    const prev = result("Contradicted", [contradictEv("A")], contradictAudit);
    const next = enforceDowngradeOnly(prev, "Insufficient", "cam B shows the mug was occluded");
    expect(next.verdict).toBe("Insufficient");
    expect(next.history).toEqual([
      { from: "Contradicted", to: "Insufficient", by: "skeptic", reason: "cam B shows the mug was occluded", at: NOW },
    ]);
  });

  it("downgrades a weak Supported label to Insufficient", () => {
    const prev = result("Supported", [supportEv("A", 0.82)], supportAudit);
    const next = enforceDowngradeOnly(prev, "Insufficient", "support rests on one blurry view");
    expect(next.verdict).toBe("Insufficient");
    expect(next.history.at(-1)).toMatchObject({ from: "Supported", to: "Insufficient", by: "skeptic" });
    expect(next.history.at(-1)?.blocked).toBeUndefined();
  });

  it("blocks a reversal from Contradicted to Supported", () => {
    const prev = result("Contradicted", [contradictEv("A")], contradictAudit);
    const next = enforceDowngradeOnly(prev, "Supported", "skeptic thinks it happened");
    expect(next.verdict).toBe("Contradicted");
    expect(next.history).toEqual([
      { from: "Contradicted", to: "Supported", by: "skeptic", blocked: true, reason: "skeptic thinks it happened", at: NOW },
    ]);
  });

  it("blocks a reversal from Supported to Contradicted", () => {
    const prev = result("Supported", [supportEv("A")], supportAudit);
    const next = enforceDowngradeOnly(prev, "Contradicted", "x");
    expect(next.verdict).toBe("Supported");
    expect(next.history.at(-1)).toMatchObject({ from: "Supported", to: "Contradicted", blocked: true });
  });

  it("blocks creating a new Contradicted from Insufficient", () => {
    const prev = result("Insufficient", [], null);
    const next = enforceDowngradeOnly(prev, "Contradicted", "x");
    expect(next.verdict).toBe("Insufficient");
    expect(next.history.at(-1)).toMatchObject({ from: "Insufficient", to: "Contradicted", blocked: true });
  });

  it("blocks creating a new Supported from Insufficient", () => {
    const prev = result("Insufficient", [], null);
    const next = enforceDowngradeOnly(prev, "Supported", "x");
    expect(next.verdict).toBe("Insufficient");
    expect(next.history.at(-1)).toMatchObject({ from: "Insufficient", to: "Supported", blocked: true });
  });

  it("keeps a correct Supported label without logging a change", () => {
    const prev = result("Supported", [supportEv("A"), supportEv("B")], supportAudit);
    const next = enforceDowngradeOnly(prev, "Supported", "checked cam C, consistent");
    expect(next.verdict).toBe("Supported");
    expect(next.history).toEqual([]);
  });

  it("keeps Contradicted and Insufficient labels when the skeptic agrees", () => {
    expect(enforceDowngradeOnly(result("Contradicted", [], null), "Contradicted", "x").history).toEqual([]);
    expect(enforceDowngradeOnly(result("Insufficient", [], null), "Insufficient", "x").history).toEqual([]);
  });

  it("appends to existing history and preserves evidence, audit and claimId", () => {
    const earlier = { from: "Insufficient", to: "Contradicted", by: "investigator", reason: "r", at: "t0" } as const;
    const e = [contradictEv("A")];
    const prev = result("Contradicted", e, contradictAudit, [earlier]);
    const next = enforceDowngradeOnly(prev, "Insufficient", "y");
    expect(next.history).toHaveLength(2);
    expect(next.history[0]).toEqual(earlier);
    expect(next.evidence).toEqual(e);
    expect(next.audit).toEqual(contradictAudit);
    expect(next.claimId).toBe("c1");
  });

  it("does not mutate the previous result", () => {
    const prev = result("Contradicted", [contradictEv("A")], contradictAudit);
    const snapshot = JSON.stringify(prev);
    enforceDowngradeOnly(prev, "Insufficient", "x");
    enforceDowngradeOnly(prev, "Supported", "x");
    expect(JSON.stringify(prev)).toBe(snapshot);
  });
});

// ---------- isWeakSupport() ----------

describe("isWeakSupport", () => {
  const strong = (): ClaimResult =>
    result("Supported", [supportEv("A", 0.95), supportEv("B", 0.93), ev("C")], supportAudit);

  it("is false for strong support from two cameras with a confident audit", () => {
    expect(isWeakSupport(strong(), claim())).toBe(false);
  });

  it("is false for labels other than Supported", () => {
    const weak = [supportEv("A", 0.81)];
    expect(isWeakSupport(result("Contradicted", weak, audit(0.81, 0)), claim())).toBe(false);
    expect(isWeakSupport(result("Insufficient", weak, audit(0.81, 0)), claim())).toBe(false);
  });

  it("is true when only one usable camera supports", () => {
    const r = result("Supported", [supportEv("A", 0.99), ev("B", { supports: 0.3 })], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when the second supporting camera is not usable", () => {
    const r = result("Supported", [supportEv("A", 0.99), supportEv("B", 0.99, { visible: 0.4 })], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when the second supporting view is outside the claim window", () => {
    const r = result("Supported", [supportEv("A", 0.99), supportEv("B", 0.99, { window: [50, 52] })], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("counts cameras, not evidence rows: two views from one camera are one camera", () => {
    const r = result("Supported", [supportEv("A", 0.99), supportEv("A", 0.97, { window: [12, 14] })], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when the strongest camera support is within the margin of CLEAR", () => {
    const s = CLEAR + WEAK_SUPPORT_MARGIN - 0.001;
    const r = result("Supported", [supportEv("A", s), supportEv("B", s)], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true at exactly CLEAR + margin, false just above it", () => {
    const at = CLEAR + WEAK_SUPPORT_MARGIN;
    expect(isWeakSupport(result("Supported", [supportEv("A", at), supportEv("B", at)], supportAudit), claim())).toBe(
      true,
    );
    const above = at + 0.001;
    expect(
      isWeakSupport(result("Supported", [supportEv("A", above), supportEv("B", above)], supportAudit), claim()),
    ).toBe(false);
  });

  it("is false when one camera is near the threshold but another is strong", () => {
    const r = result("Supported", [supportEv("A", 0.81), supportEv("B", 0.95)], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(false);
  });

  it("is true when the audit support score is within the margin of CLEAR", () => {
    const r = result("Supported", [supportEv("A"), supportEv("B")], audit(CLEAR + 0.02, 0));
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when every supporting camera is barely usable", () => {
    const o = { visible: USABLE + 0.02 };
    const r = result("Supported", [supportEv("A", 0.95, o), supportEv("B", 0.95, o)], supportAudit);
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when a usable camera nearly contradicts", () => {
    const r = result(
      "Supported",
      [supportEv("A"), supportEv("B"), ev("C", { contradicts: CLEAR - 0.02 })],
      supportAudit,
    );
    expect(isWeakSupport(r, claim())).toBe(true);
  });

  it("is true when the audit is missing", () => {
    expect(isWeakSupport(result("Supported", [supportEv("A"), supportEv("B")], null), claim())).toBe(true);
  });
});
