// OWNER: Dev 2. Evidence and citation for a state claim with a REGISTERED exclusive opposite
// (e.g. touching_worker <-> clear_of_worker). Contradiction needs the opposite seen strongly, the claimed
// state low, on a usable camera, throughout the claim window; a low claimed score alone never counts.
import { describe, expect, it } from "vitest";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { selectCitation } from "@/lib/inference/citation";
import { evidenceForTarget, type EvidenceTarget } from "@/lib/inference/evidence";
import { verdict } from "@/lib/inference/verdict";
import type { Audit, CameraId, Claim, GridRow, Question } from "@/lib/types";

const Q = (id: string, value: string, entityId = "forklift", predicate: Question["predicate"] = "state"): Question => ({ id, entityId, predicate, value, text: `${value}?` });
const QS: Question[] = [
  Q("touch", "touching worker"),
  Q("clear", "clear of worker"),
  Q("moving", "moving"),
  Q("dodge", "dodging", "worker"),
  Q("vis", "yes", "forklift", "visible"),
];
const TOUCH: EvidenceTarget = { questionId: "touch", alternativeIds: ["clear"], registeredExclusive: true };
const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "c",
  sceneId: "s1",
  text: "The forklift touched the worker",
  actor: "",
  object: "forklift",
  action: "state touched worker",
  window: [2, 5],
  timeIsPrecise: false,
  ...o,
});
function fill(camera: CameraId, t0: number, t1: number, values: Record<string, number>, pVisible = 0.95): GridRow[] {
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries(values)) rows.push({ sceneId: "s1", camera, t, questionId, pYes, pVisible });
  return rows;
}
const support: Audit = { supportScore: 0.95, contradictScore: 0.03, clipId: "a" };
const contra: Audit = { supportScore: 0.03, contradictScore: 0.96, clipId: "a" };

describe("state target validation", () => {
  it("state alternatives are only accepted when flagged as registered exclusive pairs", () => {
    const rows = fill("A", 2, 5, { touch: 0.03, clear: 0.97 });
    const unflagged = evidenceForTarget(claim(), { questionId: "touch", alternativeIds: ["clear"] }, rows, QS);
    expect(unflagged.every((e) => e.supports === null && e.contradicts === null && e.visible === 0)).toBe(true);
    expect(evidenceForTarget(claim(), TOUCH, rows, QS)[0]!.contradicts).toBeCloseTo(0.97);
  });

  it("a flagged alternative must still be a state question of the same entity", () => {
    const rows = fill("A", 2, 5, { touch: 0.03, dodge: 0.97, vis: 0.97 });
    for (const alt of ["dodge", "vis", "missing"]) {
      const e = evidenceForTarget(claim(), { questionId: "touch", alternativeIds: [alt], registeredExclusive: true }, rows, QS);
      expect(e.every((x) => x.supports === null && x.contradicts === null)).toBe(true);
    }
  });
});

describe("contradiction from a registered opposite", () => {
  it("opposite strongly seen and claimed low throughout the window -> Contradicted (with a decisive audit)", () => {
    const rows = [...fill("A", 2, 5, { touch: 0.03, clear: 0.96 }), ...fill("B", 2, 5, { touch: 0.04, clear: 0.95 })];
    const e = evidenceForTarget(claim(), TOUCH, rows, QS);
    expect(e.every((x) => (x.contradicts ?? 0) >= THRESHOLDS.DECISIVE)).toBe(true);
    expect(verdict(e, claim(), contra)).toBe("Contradicted");
  });

  it("the claimed state seen -> Supported (opposite low)", () => {
    const rows = fill("A", 2, 5, { touch: 0.95, clear: 0.04 });
    expect(verdict(evidenceForTarget(claim(), TOUCH, rows, QS), claim(), support)).toBe("Supported");
  });

  it("a low claimed score alone is never a contradiction (opposite also low / uncertain)", () => {
    const rows = fill("A", 2, 5, { touch: 0.05, clear: 0.4 });
    const e = evidenceForTarget(claim(), TOUCH, rows, QS);
    expect(e[0]!.contradicts!).toBeLessThan(THRESHOLDS.DECISIVE);
    expect(verdict(e, claim(), contra)).toBe("Insufficient");
  });

  it("probabilities are not assumed to sum to 1: both high is conflicting, not decisive either way", () => {
    const e = evidenceForTarget(claim(), TOUCH, fill("A", 2, 5, { touch: 0.9, clear: 0.9 }), QS);
    expect(e[0]!.supports!).toBeLessThan(THRESHOLDS.CLEAR);
    expect(e[0]!.contradicts!).toBeLessThan(THRESHOLDS.CLEAR);
    expect(verdict(e, claim(), contra)).toBe("Insufficient");
    expect(verdict(e, claim(), support)).toBe("Insufficient");
  });

  it("an opposite seen only part of the window (contact could be in the gap) is not a contradiction", () => {
    const rows = [...fill("A", 2, 3.5, { touch: 0.03, clear: 0.97 }), ...fill("A", 3.5, 5, { touch: 0.03, clear: 0.97 }, 0.2)];
    const e = evidenceForTarget(claim(), TOUCH, rows, QS);
    expect(e.every((x) => x.contradicts === null)).toBe(true);
    expect(verdict(e, claim(), contra)).toBe("Insufficient");
  });

  it("an opposite seen for a moment, then the claimed state, supports rather than contradicts", () => {
    const rows = [...fill("A", 2, 3, { touch: 0.03, clear: 0.97 }), ...fill("A", 3, 5, { touch: 0.95, clear: 0.04 })];
    const e = evidenceForTarget(claim(), TOUCH, rows, QS);
    expect(e[0]!.contradicts!).toBeLessThan(THRESHOLDS.DECISIVE);
    expect(verdict(e, claim(), support)).toBe("Supported");
  });

  it("low visibility gives no scores at all", () => {
    const e = evidenceForTarget(claim(), TOUCH, fill("A", 2, 5, { touch: 0.03, clear: 0.97 }, 0.3), QS);
    expect(e.every((x) => x.supports === null && x.contradicts === null)).toBe(true);
  });

  it("cameras that disagree (one supports, one contradicts) give Insufficient", () => {
    const rows = [...fill("A", 2, 5, { touch: 0.95, clear: 0.04 }), ...fill("B", 2, 5, { touch: 0.03, clear: 0.97 })];
    const e = evidenceForTarget(claim(), TOUCH, rows, QS);
    expect(verdict(e, claim(), support)).toBe("Insufficient");
    expect(verdict(e, claim(), contra)).toBe("Insufficient");
  });

  it("without a decisive audit the contradiction is not labelled", () => {
    const e = evidenceForTarget(claim(), TOUCH, fill("A", 2, 5, { touch: 0.03, clear: 0.97 }), QS);
    expect(verdict(e, claim(), null)).toBe("Insufficient");
    expect(verdict(e, claim(), { supportScore: 0.1, contradictScore: 0.85, clipId: "a" })).toBe("Insufficient");
  });
});

describe("citation for a registered-opposite contradiction", () => {
  it("selects a contradiction window inside the claim on an allowed camera, never an excluded one", () => {
    const rows = [...fill("A", 2, 5, { touch: 0.03, clear: 0.97 }), ...fill("B", 2, 5, { touch: 0.03, clear: 0.99 })];
    const r = selectCitation(claim(), TOUCH, rows.filter((x) => x.camera === "A"), QS, { goal: "contradict", allowedCameras: ["A"] });
    expect(r).toMatchObject({ ok: true, candidate: { camera: "A", goal: "contradict" } });
    if (r.ok) {
      expect(r.candidate.window[0]).toBeGreaterThanOrEqual(2);
      expect(r.candidate.window[1]).toBeLessThanOrEqual(5);
    }
    expect(selectCitation(claim(), TOUCH, rows, QS, { goal: "contradict", allowedCameras: ["C"] })).toMatchObject({ ok: false });
  });

  it("the unflagged form never yields a contradiction citation", () => {
    const rows = fill("A", 2, 5, { touch: 0.03, clear: 0.97 });
    expect(selectCitation(claim(), { questionId: "touch", alternativeIds: ["clear"] }, rows, QS, { goal: "contradict", allowedCameras: ["A"] })).toMatchObject({ ok: false });
  });
});
