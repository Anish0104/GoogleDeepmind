// OWNER: Dev 3. Tests for which agent (if any) may run on a claim. Uses Dev 2's real isWeakSupport().
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "@/lib/config";
import type { Audit, CameraId, Claim, ClaimResult, Evidence, Verdict } from "@/lib/types";
import { camerasDisagree, eligibleAgent, explainEligibility, withoutExcluded } from "@/lib/agent/eligibility";

const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "I put the red cup in zone C",
  actor: "speaker",
  object: "red cup",
  action: "place",
  window: [10, 14],
  timeIsPrecise: false,
};

function ev(camera: CameraId, o: Partial<Evidence> = {}): Evidence {
  return {
    camera,
    window: [10, 14],
    visible: 0.95,
    supports: null,
    contradicts: null,
    clipId: `clip-${camera}`,
    source: "initial",
    ...o,
  };
}
const sup = (c: CameraId, s = 0.95, o: Partial<Evidence> = {}) => ev(c, { supports: s, contradicts: 0.01, ...o });
const con = (c: CameraId, s = 0.95, o: Partial<Evidence> = {}) => ev(c, { supports: 0.01, contradicts: s, ...o });
const strongAudit: Audit = { supportScore: 0.95, contradictScore: 0.01, clipId: "clip-A" };

function result(verdict: Verdict, evidence: Evidence[], audit: Audit | null = strongAudit): ClaimResult {
  return { claimId: "c1", verdict, evidence, audit, history: [] };
}

describe("camerasDisagree", () => {
  it("is true when one usable camera supports and another contradicts at CLEAR", () => {
    expect(camerasDisagree(result("Insufficient", [sup("A"), con("B", THRESHOLDS.CLEAR)]), claim)).toBe(true);
  });

  it("ignores unusable cameras, other windows, weak dissent and a single camera", () => {
    const low = THRESHOLDS.USABLE - 0.01;
    expect(camerasDisagree(result("Insufficient", [sup("A"), con("B", 0.95, { visible: low })]), claim)).toBe(false);
    expect(camerasDisagree(result("Insufficient", [sup("A"), con("B", 0.95, { window: [30, 32] })]), claim)).toBe(false);
    expect(camerasDisagree(result("Insufficient", [sup("A"), con("B", THRESHOLDS.CLEAR - 0.01)]), claim)).toBe(false);
    expect(camerasDisagree(result("Insufficient", [sup("A"), con("A", 0.95, { window: [12, 14] })]), claim)).toBe(false);
    expect(camerasDisagree(result("Insufficient", []), claim)).toBe(false);
  });
});

describe("eligibleAgent", () => {
  it("Insufficient: investigator", () => {
    expect(eligibleAgent(result("Insufficient", [ev("A", { visible: 0.2 })]), claim)).toBe("investigator");
    expect(eligibleAgent(result("Insufficient", []), claim)).toBe("investigator");
  });

  it("two usable cameras disagree: investigator", () => {
    const r = result("Insufficient", [sup("A"), con("B")]);
    expect(eligibleAgent(r, claim)).toBe("investigator");
    expect(explainEligibility(r, claim).reason).toMatch(/disagree/i);
  });

  it("Contradicted: skeptic", () => {
    expect(eligibleAgent(result("Contradicted", [con("A"), con("B")]), claim)).toBe("skeptic");
  });

  it("weak Supported (one supporting camera): skeptic", () => {
    expect(eligibleAgent(result("Supported", [sup("A")]), claim)).toBe("skeptic");
  });

  it("weak Supported (score within WEAK_SUPPORT_MARGIN of CLEAR): skeptic", () => {
    const s = THRESHOLDS.CLEAR + THRESHOLDS.WEAK_SUPPORT_MARGIN / 2;
    expect(eligibleAgent(result("Supported", [sup("A", s), sup("B", s)]), claim)).toBe("skeptic");
  });

  it("strong Supported: neither agent", () => {
    const r = result("Supported", [sup("A"), sup("B")]);
    expect(eligibleAgent(r, claim)).toBeNull();
    expect(explainEligibility(r, claim).reason).toMatch(/strong/i);
  });

  it("a decided label with disagreeing cameras goes to the downgrade-only skeptic, never the investigator", () => {
    expect(eligibleAgent(result("Contradicted", [con("A"), sup("B")]), claim)).toBe("skeptic");
    expect(eligibleAgent(result("Supported", [sup("A"), sup("C"), con("B")]), claim)).toBe("skeptic");
  });
});

describe("withoutExcluded", () => {
  it("drops evidence from excluded cameras and keeps order", () => {
    const e = [sup("A"), sup("D"), con("B")];
    expect(withoutExcluded(e, ["D"])).toEqual([sup("A"), con("B")]);
    expect(withoutExcluded(e, [])).toEqual(e);
  });
});
