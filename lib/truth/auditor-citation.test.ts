// OWNER: Dev 2. Tests for auditCitation(): auditing a selected citation window through checkWindow()
// (mocked at Dev 1's module boundary) without inventing Evidence scores.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));

import { checkWindow } from "@/lib/perception/checkWindow";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { selectCitation, type CitationCandidate } from "@/lib/inference/citation";
import { evidenceForTarget, type EvidenceTarget } from "@/lib/inference/evidence";
import { verdict } from "@/lib/inference/verdict";
import { auditCitation } from "@/lib/truth/auditor";
import { AuditInputError, AuditUnavailableError } from "@/lib/truth/errors";
import type { CameraId, Claim, Evidence, GridRow, Question } from "@/lib/types";

const cw = vi.mocked(checkWindow);

const QS: Question[] = [
  { id: "mugB", entityId: "e1", predicate: "location", value: "B", text: "Is the mug in zone B?" },
  { id: "mugC", entityId: "e1", predicate: "location", value: "C", text: "Is the mug in zone C?" },
];
const TO_C: EvidenceTarget = { questionId: "mugC", alternativeIds: ["mugB"] };
const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "c1",
  sceneId: "s1",
  text: "Sam put the mug in zone C",
  actor: "Sam",
  object: "mug",
  action: "move to zone C",
  window: [0, 12],
  timeIsPrecise: false,
  ...o,
});
function fill(camera: CameraId, t0: number, t1: number, values: Record<string, number>, pVisible = 0.95): GridRow[] {
  const rows: GridRow[] = [];
  for (let t = t0; t < t1 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries(values)) rows.push({ sceneId: "s1", camera, t, questionId, pYes, pVisible });
  return rows;
}
const IN_C = { mugC: 0.95, mugB: 0.05 };
const IN_B = { mugC: 0.03, mugB: 0.96 };
const ROWS = [...fill("A", 0, 6, IN_B), ...fill("A", 6, 12, IN_C)];

const pick = (c: Claim, rows: GridRow[], goal: "support" | "contradict"): CitationCandidate => {
  const r = selectCitation(c, TO_C, rows, QS, { goal, allowedCameras: ["A", "B", "C", "D"] });
  if (!r.ok) throw new Error(r.reason);
  return r.candidate;
};
const answer = (cand: CitationCandidate, o: Partial<Evidence> = {}): Evidence => ({
  camera: cand.camera,
  window: cand.window,
  visible: 0.92,
  supports: 0.91,
  contradicts: 0.04,
  clipId: "A_6.00-10.00_full",
  source: "initial",
  ...o,
});

beforeEach(() => cw.mockReset());

describe("auditCitation", () => {
  it("asks checkWindow about exactly the selected camera and window", async () => {
    const cand = pick(claim(), ROWS, "support");
    cw.mockResolvedValueOnce(answer(cand));
    await auditCitation(claim(), cand);
    expect(cw).toHaveBeenCalledTimes(1);
    expect(cw).toHaveBeenCalledWith({ sceneId: "s1", camera: "A", window: [6, 10], crop: "full", claim: claim(), source: "initial" });
  });

  it("returns the audit with the citation's own grid reference as clipId", async () => {
    const cand = pick(claim(), ROWS, "support");
    cw.mockResolvedValueOnce(answer(cand));
    expect(await auditCitation(claim(), cand)).toEqual({ supportScore: 0.91, contradictScore: 0.04, clipId: cand.clipId });
  });

  it("supported end to end: original evidence + audited citation -> Supported; evidence untouched", async () => {
    const c = claim();
    const evidence = evidenceForTarget(c, TO_C, ROWS, QS);
    const snap = JSON.stringify(evidence);
    const cand = pick(c, ROWS, "support");
    cw.mockResolvedValueOnce(answer(cand));
    expect(verdict(evidence, c, await auditCitation(c, cand))).toBe("Supported");
    expect(JSON.stringify(evidence)).toBe(snap);
  });

  it("a decisive audit cannot rescue a vague-time contradiction the evidence does not cover", async () => {
    const c = claim({ text: "Sam put the mug in zone B", action: "move to zone B" });
    const toB: EvidenceTarget = { questionId: "mugB", alternativeIds: ["mugC"] };
    const rows = [...fill("A", 0, 6, IN_C), ...fill("A", 6, 8, IN_C, 0.2), ...fill("A", 8, 12, IN_C)];
    const evidence = evidenceForTarget(c, toB, rows, QS);
    expect(selectCitation(c, toB, rows, QS, { goal: "contradict", allowedCameras: ["A"] }).ok).toBe(false);
    // Even if a caller audited some window and it came back decisive, the verdict stays Insufficient.
    expect(verdict(evidence, c, { supportScore: 0.01, contradictScore: 0.99, clipId: "x" })).toBe("Insufficient");
  });

  it("low visibility in the audited clip abstains", async () => {
    const cand = pick(claim(), ROWS, "support");
    cw.mockResolvedValueOnce(answer(cand, { visible: THRESHOLDS.USABLE - 0.1, supports: 0.99 }));
    expect(await auditCitation(claim(), cand)).toMatchObject({ supportScore: null, contradictScore: null });
  });

  it("an unavailable clip fails safely", async () => {
    const cand = pick(claim(), ROWS, "support");
    cw.mockRejectedValueOnce(new Error("no recording"));
    await expect(auditCitation(claim(), cand)).rejects.toThrow(AuditUnavailableError);
    expect(verdict(evidenceForTarget(claim(), TO_C, ROWS, QS), claim(), null)).toBe("Insufficient");
  });

  it("rejects malformed or tampered candidates before any call", async () => {
    const cand = pick(claim(), ROWS, "support");
    const bad: CitationCandidate[] = [
      { ...cand, window: [6, 11] },
      { ...cand, window: [6, 6.5] },
      { ...cand, window: [20, 22] },
      { ...cand, camera: "Z" as never },
      { ...cand, window: [Number.NaN, 8] },
      { ...cand, clipId: "" },
      { ...cand, verified: true as never },
      { ...cand, basis: { ...cand.basis, minVisible: Number.NaN } },
    ];
    for (const b of bad) await expect(auditCitation(claim(), b)).rejects.toThrow(AuditInputError);
    expect(cw).not.toHaveBeenCalled();
  });

  it("a candidate whose observed visibility is below USABLE abstains without a call", async () => {
    const cand = pick(claim(), ROWS, "support");
    expect(await auditCitation(claim(), { ...cand, basis: { ...cand.basis, minVisible: 0.3 } })).toMatchObject({
      supportScore: null,
      contradictScore: null,
    });
    expect(cw).not.toHaveBeenCalled();
  });
});
