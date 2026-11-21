// OWNER: Dev 2. Tests for validateCitationWithinClaim(): the strict citation check that requires the
// window to lie fully inside the claim window. validateCitation()/audit() defaults stay unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));

import { checkWindow } from "@/lib/perception/checkWindow";
import { LIMITS } from "@/lib/config";
import { selectCitation } from "@/lib/inference/citation";
import { audit, auditCitation, validateCitation, validateCitationWithinClaim, type CitationRequest } from "@/lib/truth/auditor";
import { AuditInputError } from "@/lib/truth/errors";
import type { CameraId, Claim, Evidence, GridRow } from "@/lib/types";

const cw = vi.mocked(checkWindow);
beforeEach(() => cw.mockReset());

const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "c1",
  sceneId: "s1",
  text: "Sam put the mug in zone C",
  actor: "Sam",
  object: "mug",
  action: "move to zone C",
  window: [21, 24],
  timeIsPrecise: true,
  ...o,
});
const req = (window: [number, number], o: Partial<CitationRequest> = {}): CitationRequest => ({ camera: "A", window, source: "investigator", ...o });
const ev = (window: [number, number], o: Partial<Evidence> = {}): Evidence => ({
  camera: "A",
  window,
  visible: 0.9,
  supports: 0.9,
  contradicts: 0.05,
  clipId: "x",
  source: "investigator",
  ...o,
});

describe("validateCitationWithinClaim", () => {
  it("accepts windows fully inside the claim, including the whole claim", () => {
    expect(validateCitationWithinClaim(claim(), req([21, 24]))).toEqual({ ok: true });
    expect(validateCitationWithinClaim(claim(), req([22, 23.5]))).toEqual({ ok: true });
    expect(validateCitationWithinClaim(claim({ window: [21.2, 23.7] }), req([21.2, 23.7]))).toEqual({ ok: true });
  });

  it("tolerates float noise at the edges", () => {
    expect(validateCitationWithinClaim(claim({ window: [21.2, 23.7] }), req([21.2 + 1e-9, 23.7 - 1e-9]))).toEqual({ ok: true });
    expect(validateCitationWithinClaim(claim({ window: [0.1 + 0.2, 2] }), req([0.3, 2]))).toEqual({ ok: true });
  });

  it("rejects windows that extend past either end of the claim", () => {
    for (const w of [[22, 26], [20.5, 23], [23.5, 27.5], [20, 21.5]] as [number, number][]) {
      const r = validateCitationWithinClaim(claim(), req(w));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/inside the claim window/);
    }
  });

  it("rejects windows outside or only touching the claim", () => {
    expect(validateCitationWithinClaim(claim(), req([24, 26])).ok).toBe(false);
    expect(validateCitationWithinClaim(claim(), req([17, 21])).ok).toBe(false);
  });

  it("a claim shorter than CLIP_MIN_S can never be cited strictly", () => {
    const r = validateCitationWithinClaim(claim({ window: [21.2, 22] }), req([21.2, 22]));
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/1-4 s/) });
  });

  const bad: [string, Partial<Claim>, CitationRequest, RegExp][] = [
    ["NaN window", {}, req([Number.NaN, 23]), /finite/],
    ["reversed window", {}, req([23, 22]), /ordered/],
    ["negative start", { window: [0, 3] }, req([-1, 2]), /negative/],
    ["too short", {}, req([22, 22.5]), /1-4 s/],
    ["too long", { window: [20, 30] }, req([21, 25.5]), /1-4 s/],
    ["unknown camera", {}, req([22, 23], { camera: "Z" as CameraId }), /camera/],
    ["bad source", {}, req([22, 23], { source: "oracle" as never }), /source/],
    ["empty clipId", {}, req([22, 23], { clipId: "  " }), /clipId/],
    ["invalid claim window", { window: [24, 21] }, req([22, 23]), /claim window/],
    ["blank claim text", { text: " " }, req([22, 23]), /claim text/],
    ["missing sceneId", { sceneId: "" }, req([22, 23]), /sceneId/],
  ];
  it.each(bad)("rejects %s", (_n, c, r, re) => {
    const out = validateCitationWithinClaim(claim(c), r);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(re);
  });

  it("works before a clip exists (no clipId) and on Evidence", () => {
    expect(validateCitationWithinClaim(claim(), req([22, 23]))).toEqual({ ok: true });
    expect(validateCitationWithinClaim(claim(), ev([22, 23]))).toEqual({ ok: true });
    expect(validateCitationWithinClaim(claim(), ev([22, 26])).ok).toBe(false);
  });

  it("is pure: no model or clip calls", () => {
    validateCitationWithinClaim(claim(), req([22, 26]));
    expect(cw).not.toHaveBeenCalled();
  });
});

describe("default behaviour is unchanged", () => {
  it("validateCitation() still accepts a window that only partly overlaps the claim", () => {
    expect(validateCitation(claim(), ev([22, 26]))).toEqual({ ok: true });
  });

  it("audit() still audits such a window as before (one checkWindow call on exactly that window)", async () => {
    cw.mockResolvedValueOnce(ev([22, 26], { clipId: "A_22.00-26.00_full" }));
    expect(await audit(claim(), ev([22, 26]))).toEqual({ supportScore: 0.9, contradictScore: 0.05, clipId: "x" });
    expect(cw).toHaveBeenCalledTimes(1);
    expect(cw.mock.calls[0]![0].window).toEqual([22, 26]);
  });
});

describe("auditCitation uses the strict check", () => {
  const rows: GridRow[] = [];
  for (let t = 20; t < 25 - 1e-9; t += LIMITS.SLICE_S)
    for (const [questionId, pYes] of Object.entries({ mugC: 0.95, mugB: 0.05 })) rows.push({ sceneId: "s1", camera: "A", t, questionId, pYes, pVisible: 0.95 });
  const QS = [
    { id: "mugB", entityId: "e1", predicate: "location" as const, value: "B", text: "Is the mug in zone B?" },
    { id: "mugC", entityId: "e1", predicate: "location" as const, value: "C", text: "Is the mug in zone C?" },
  ];
  const c = claim({ window: [21.2, 23.7] });
  const sel = selectCitation(c, { questionId: "mugC", alternativeIds: ["mugB"] }, rows, QS, { goal: "support", allowedCameras: ["A"] });

  it("audits exactly the clamped window", async () => {
    if (!sel.ok) throw new Error(sel.reason);
    cw.mockResolvedValueOnce(ev([21.2, 23.7], { clipId: "A_21.20-23.70_full" }));
    await auditCitation(c, sel.candidate);
    expect(cw.mock.calls[0]![0].window).toEqual([21.2, 23.7]);
  });

  it("rejects a tampered candidate that extends past the claim, before any call", async () => {
    if (!sel.ok) throw new Error(sel.reason);
    await expect(auditCitation(c, { ...sel.candidate, window: [21, 24] })).rejects.toThrow(AuditInputError);
    expect(cw).not.toHaveBeenCalled();
  });
});
