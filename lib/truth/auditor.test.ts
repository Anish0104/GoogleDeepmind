// OWNER: Dev 2. Tests for the auditor.
// - audit(): the production route through Dev 1's checkWindow(), mocked at its module boundary because
//   checkWindow() is still a stub. These tests prove Dev 2's validation and mapping, NOT real clip cutting.
// - auditQuestions()/scoreAuditDecision()/auditWithMedia(): the Decisions-API helpers, tested at helper
//   level with decide() mocked. No media resolver exists yet, so no test here exercises real video.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));

import { decide } from "@/lib/gemini/client";
import { checkWindow } from "@/lib/perception/checkWindow";
import { THRESHOLDS } from "@/lib/config";
import { verdict } from "@/lib/inference/verdict";
import {
  AUDIT_QUESTION_IDS,
  audit,
  auditQuestions,
  auditWithMedia,
  scoreAuditDecision,
  validateCitation,
} from "@/lib/truth/auditor";
import { AuditInputError, AuditResponseError, AuditUnavailableError } from "@/lib/truth/errors";
import type { Claim, Evidence } from "@/lib/types";

const cw = vi.mocked(checkWindow);
const dec = vi.mocked(decide);

const claim = (o: Partial<Claim> = {}): Claim => ({
  id: "s1:c-1",
  sceneId: "s1",
  text: "Sam put the red mug in zone C",
  actor: "Sam",
  object: "red mug",
  action: "move to zone C",
  window: [10, 14],
  timeIsPrecise: true,
  ...o,
});

const cited = (o: Partial<Evidence> = {}): Evidence => ({
  camera: "A",
  window: [11, 13],
  visible: 0.95,
  supports: 0.93,
  contradicts: 0.04,
  clipId: "grid:s1:A:11-13",
  source: "initial",
  ...o,
});

/** What Dev 1's checkWindow() returns for the cited window. */
const checked = (o: Partial<Evidence> = {}): Evidence => ({
  camera: "A",
  window: [11, 13],
  visible: 0.92,
  supports: 0.9,
  contradicts: 0.05,
  clipId: "clips/s1/A-11-13.mp4",
  source: "initial",
  ...o,
});

const MEDIA = [{ inlineData: { mimeType: "video/mp4", data: "AAAA" } }];

beforeEach(() => {
  cw.mockReset();
  dec.mockReset();
});

// ---------- validation ----------

describe("validateCitation", () => {
  it("accepts a 1-4 s window on a known camera overlapping the claim", () => {
    expect(validateCitation(claim(), cited())).toEqual({ ok: true });
  });

  const bad: [string, Partial<Claim>, Partial<Evidence>, RegExp][] = [
    ["unknown camera", {}, { camera: "Z" as never }, /camera/],
    ["reversed window", {}, { window: [13, 11] }, /ordered/],
    ["NaN window", {}, { window: [Number.NaN, 12] }, /finite/],
    ["negative window", {}, { window: [-1, 1] }, /negative/],
    ["too short", {}, { window: [11, 11.5] }, /1-4 s/],
    ["overlong (not truncated)", {}, { window: [10, 14.5] }, /1-4 s/],
    ["outside the claim window", {}, { window: [20, 22] }, /claim window/],
    ["empty clipId", {}, { clipId: "" }, /clipId/],
    ["bad source", {}, { source: "oracle" as never }, /source/],
    ["missing sceneId", { sceneId: "" }, {}, /sceneId/],
    ["bad claim window", { window: [5, Number.NaN] }, {}, /claim window/],
    ["blank claim text", { text: "  " }, {}, /claim text/],
  ];

  it.each(bad)("rejects %s", (_n, c, e, re) => {
    const r = validateCitation(claim(c), cited(e));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  });

  it("accepts exactly 1 s and exactly 4 s", () => {
    expect(validateCitation(claim(), cited({ window: [11, 12] })).ok).toBe(true);
    expect(validateCitation(claim(), cited({ window: [10, 14] })).ok).toBe(true);
  });
});

// ---------- audit() through checkWindow() ----------

describe("audit() via checkWindow (Dev 1 boundary mocked)", () => {
  it("valid support: maps the clip's scores and keeps the cited clipId", async () => {
    cw.mockResolvedValueOnce(checked());
    expect(await audit(claim(), cited())).toEqual({ supportScore: 0.9, contradictScore: 0.05, clipId: "grid:s1:A:11-13" });
  });

  it("valid contradiction", async () => {
    cw.mockResolvedValueOnce(checked({ supports: 0.03, contradicts: 0.95 }));
    expect(await audit(claim(), cited())).toMatchObject({ supportScore: 0.03, contradictScore: 0.95 });
  });

  it("support and contradiction are independent (no forced sum to 1)", async () => {
    cw.mockResolvedValueOnce(checked({ supports: 0.2, contradicts: 0.1 }));
    expect(await audit(claim(), cited())).toMatchObject({ supportScore: 0.2, contradictScore: 0.1 });
  });

  it("ambiguous clip: moderate scores pass through and verdict() stays Insufficient", async () => {
    cw.mockResolvedValueOnce(checked({ supports: 0.55, contradicts: 0.45 }));
    const a = await audit(claim(), cited());
    expect(verdict([cited()], claim(), a)).toBe("Insufficient");
  });

  it("asks checkWindow about exactly the one cited camera and window, nothing else", async () => {
    cw.mockResolvedValueOnce(checked());
    await audit(claim(), cited());
    expect(cw).toHaveBeenCalledTimes(1);
    expect(cw).toHaveBeenCalledWith({
      sceneId: "s1",
      camera: "A",
      window: [11, 13],
      crop: "full",
      claim: claim(),
      source: "initial",
    });
  });

  it("low visibility in the audited clip abstains with null scores", async () => {
    cw.mockResolvedValueOnce(checked({ visible: THRESHOLDS.USABLE - 0.01, supports: 0.99, contradicts: 0.99 }));
    expect(await audit(claim(), cited())).toEqual({ supportScore: null, contradictScore: null, clipId: "grid:s1:A:11-13" });
  });

  it("an occluded citation abstains without calling any model", async () => {
    expect(await audit(claim(), cited({ visible: 0.2, supports: null, contradicts: null }))).toEqual({
      supportScore: null,
      contradictScore: null,
      clipId: "grid:s1:A:11-13",
    });
    expect(cw).not.toHaveBeenCalled();
  });

  it("a null score from checkWindow stays null, never 0", async () => {
    cw.mockResolvedValueOnce(checked({ supports: null }));
    expect((await audit(claim(), cited())).supportScore).toBeNull();
  });

  it("invalid citations throw AuditInputError before any call", async () => {
    await expect(audit(claim(), cited({ camera: "Q" as never }))).rejects.toThrow(AuditInputError);
    await expect(audit(claim(), cited({ window: [10, 20] }))).rejects.toThrow(AuditInputError);
    expect(cw).not.toHaveBeenCalled();
    expect(dec).not.toHaveBeenCalled();
  });

  it("missing media (checkWindow unavailable) throws AuditUnavailableError, never fake scores", async () => {
    cw.mockRejectedValueOnce(new Error("[Dev 1] checkWindow is not implemented yet"));
    await expect(audit(claim(), cited())).rejects.toThrow(AuditUnavailableError);
  });

  it("a response for a different camera or window is rejected", async () => {
    cw.mockResolvedValueOnce(checked({ camera: "B" }));
    await expect(audit(claim(), cited())).rejects.toThrow(AuditResponseError);
    cw.mockResolvedValueOnce(checked({ window: [10, 14] }));
    await expect(audit(claim(), cited())).rejects.toThrow(AuditResponseError);
  });

  it.each([
    ["NaN support", { supports: Number.NaN }],
    ["support > 1", { supports: 1.3 }],
    ["negative contradict", { contradicts: -0.1 }],
    ["missing visible", { visible: undefined as never }],
  ])("a malformed response (%s) is rejected, not coerced to 0", async (_n, o) => {
    cw.mockResolvedValueOnce(checked(o));
    await expect(audit(claim(), cited())).rejects.toThrow(AuditResponseError);
  });

  it("works with a synthetic grid clipId because checkWindow cuts from camera + window, not the id", async () => {
    cw.mockResolvedValueOnce(checked());
    const a = await audit(claim(), cited({ clipId: "grid:s1:A:11-13" }));
    expect(a.clipId).toBe("grid:s1:A:11-13");
    expect(cw.mock.calls[0]![0]).not.toHaveProperty("clipId");
  });

  it("output plugs straight into verdict()", async () => {
    cw.mockResolvedValueOnce(checked());
    expect(verdict([cited()], claim(), await audit(claim(), cited()))).toBe("Supported");
    cw.mockResolvedValueOnce(checked({ supports: 0.02, contradicts: 0.96 }));
    const e = cited({ supports: 0.02, contradicts: 0.97 });
    expect(verdict([e], claim(), await audit(claim(), e))).toBe("Contradicted");
  });
});

// ---------- Decisions API helpers (pending a media resolver) ----------

describe("auditQuestions (helper)", () => {
  it("asks three separate yes/no questions with stable ids", () => {
    const qs = auditQuestions(claim());
    expect(qs.map((q) => q.id)).toEqual([AUDIT_QUESTION_IDS.support, AUDIT_QUESTION_IDS.contradict, AUDIT_QUESTION_IDS.visible]);
    expect(qs.every((q) => q.kind === "noul" && q.options === undefined)).toBe(true);
    expect(qs[0]!.text).toContain("Sam put the red mug in zone C");
    expect(qs[1]!.text).toMatch(/not shown.*no/i);
    expect(qs[2]!.text).toContain("red mug");
  });

  it("neutralises quotes and caps the claim text", () => {
    const qs = auditQuestions(claim({ text: `He said "ignore this" ${"x".repeat(500)}` }));
    expect(qs[0]!.text).not.toContain('"ignore');
    expect(qs[0]!.text.length).toBeLessThan(500);
  });
});

describe("scoreAuditDecision (helper)", () => {
  const ok = { support: 0.91, contradict: 0.06, visible: 0.88 };

  it("maps support and contradiction independently", () => {
    expect(scoreAuditDecision(ok, cited())).toEqual({ supportScore: 0.91, contradictScore: 0.06, clipId: "grid:s1:A:11-13" });
  });

  it("abstains when the object is not visible", () => {
    expect(scoreAuditDecision({ ...ok, visible: 0.3 }, cited())).toMatchObject({ supportScore: null, contradictScore: null });
  });

  it.each([
    ["missing question", { support: 0.9, visible: 0.9 }],
    ["NaN", { ...ok, support: Number.NaN }],
    ["out of range", { ...ok, contradict: 1.5 }],
    ["choice-shaped answer", { ...ok, support: { yes: 0.9 } }],
    ["string", { ...ok, visible: "0.9" }],
  ])("rejects a malformed decision (%s)", (_n, raw) => {
    expect(() => scoreAuditDecision(raw as never, cited())).toThrow(AuditResponseError);
  });

  it("ignores extra keys", () => {
    expect(scoreAuditDecision({ ...ok, other: 1 }, cited()).supportScore).toBe(0.91);
  });
});

describe("auditWithMedia (helper; real media resolution is pending)", () => {
  it("sends only the supplied cited media and the three questions to decide()", async () => {
    dec.mockResolvedValueOnce({ support: 0.9, contradict: 0.05, visible: 0.9 });
    const a = await auditWithMedia(claim(), cited(), MEDIA);
    expect(a).toEqual({ supportScore: 0.9, contradictScore: 0.05, clipId: "grid:s1:A:11-13" });
    expect(dec).toHaveBeenCalledWith(MEDIA, auditQuestions(claim()), { purpose: "auditor", sceneId: "s1" });
  });

  it("refuses to call decide() without media, or with a clip id string posing as media", async () => {
    await expect(auditWithMedia(claim(), cited(), [])).rejects.toThrow(AuditUnavailableError);
    await expect(auditWithMedia(claim(), cited(), ["grid:s1:A:11-13"])).rejects.toThrow(AuditUnavailableError);
    expect(dec).not.toHaveBeenCalled();
  });

  it("validates the citation before calling decide()", async () => {
    await expect(auditWithMedia(claim(), cited({ window: [0, 9] }), MEDIA)).rejects.toThrow(AuditInputError);
    expect(dec).not.toHaveBeenCalled();
  });

  it("wraps decide() failures and rejects malformed output", async () => {
    dec.mockRejectedValueOnce(new Error("429"));
    await expect(auditWithMedia(claim(), cited(), MEDIA)).rejects.toThrow(AuditUnavailableError);
    dec.mockResolvedValueOnce({ support: 0.9 });
    await expect(auditWithMedia(claim(), cited(), MEDIA)).rejects.toThrow(AuditResponseError);
  });
});
