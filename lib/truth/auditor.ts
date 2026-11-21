// OWNER: Dev 2. Decision 1 sees ONLY the cited clip and the claim (through Dev 1's checkWindow()).
//
// Two routes, one contract:
// - audit(claim, cited): the production route named in docs/DEV2. It validates the citation, then asks
//   Dev 1's checkWindow() about exactly one camera and one 1-4 s window. checkWindow() cuts that clip
//   from the local recording itself (camera + window), so a synthetic grid clipId ("grid:...") is never
//   treated as media. checkWindow() is still a Dev 1 stub; until it ships, audit() throws
//   AuditUnavailableError and callers fall back to verdict(evidence, claim, null) -> Insufficient.
// - auditWithMedia(claim, cited, media): the Decisions-API route for when someone already holds the cited
//   clip as model parts. No repo interface resolves a clipId to parts yet, so this is helper-level only.
//
// Scores: supportScore and contradictScore are independent (they need not sum to 1). If the audited
// view is not usable (visibility < THRESHOLDS.USABLE) both are null: abstain, never decisive. A low
// support score is never turned into a contradiction. No label is ever set here; only verdict() does.
// Audit.clipId is the cited clipId, unchanged, so the audit stays linked to the evidence it checked.
import { z } from "zod";
import type { Audit, CameraId, Claim, Evidence } from "@/lib/types";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { decide, type DecisionQuestion } from "@/lib/gemini/client";
import { checkWindow } from "@/lib/perception/checkWindow";
import { CAMERA_IDS } from "@/lib/inference/grid";
import { overlaps } from "@/lib/inference/window";
import type { CitationCandidate } from "@/lib/inference/citation";
import { AuditInputError, AuditResponseError, AuditUnavailableError } from "@/lib/truth/errors";

const EPS = 1e-6;
const SOURCES: readonly Evidence["source"][] = ["initial", "investigator", "skeptic"];
const MAX_QUESTION_CLAIM_CHARS = 300;

export const AUDIT_QUESTION_IDS = { support: "support", contradict: "contradict", visible: "visible" } as const;

export type CitationCheck = { ok: true } | { ok: false; reason: string };

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const fmtW = (w: readonly number[]) => `[${w.join(", ")}]`;

/** Checks that `cited` is one valid, auditable 1-4 s window on one camera, relevant to `claim`. */
export function validateCitation(claim: Claim, cited: Evidence): CitationCheck {
  const no = (reason: string): CitationCheck => ({ ok: false, reason });
  if (typeof claim?.sceneId !== "string" || claim.sceneId === "") return no("claim has no sceneId");
  if (typeof claim.text !== "string" || claim.text.trim() === "") return no("claim text is blank");
  const cw = claim.window;
  if (!Array.isArray(cw) || cw.length !== 2 || !finite(cw[0]) || !finite(cw[1]) || cw[0] < 0 || cw[1] <= cw[0])
    return no(`claim window ${String(cw)} is invalid`);

  if (!CAMERA_IDS.includes(cited?.camera)) return no(`unknown camera ${String(cited?.camera)}`);
  if (!SOURCES.includes(cited.source)) return no(`unknown evidence source ${String(cited.source)}`);
  if (typeof cited.clipId !== "string" || cited.clipId.trim() === "") return no("cited evidence has no clipId");
  const w = cited.window;
  if (!Array.isArray(w) || w.length !== 2 || !finite(w[0]) || !finite(w[1])) return no("cited window must be two finite numbers");
  if (w[0] < 0) return no(`cited window ${fmtW(w)} starts at a negative time`);
  if (w[1] <= w[0]) return no(`cited window ${fmtW(w)} is not ordered`);
  const len = w[1] - w[0];
  if (len < LIMITS.CLIP_MIN_S - EPS || len > LIMITS.CLIP_MAX_S + EPS)
    return no(`cited window ${fmtW(w)} is ${Number(len.toFixed(3))} s; clips must be ${LIMITS.CLIP_MIN_S}-${LIMITS.CLIP_MAX_S} s (not truncated)`);
  if (!overlaps(w, cw)) return no(`cited window ${fmtW(w)} does not overlap the claim window ${fmtW(cw)}`);
  return { ok: true };
}

/** A window to be audited, possibly before any clip has been cut (no clipId yet). Evidence fits too. */
export interface CitationRequest {
  camera: CameraId;
  window: [number, number];
  source: Evidence["source"];
  clipId?: string;
}

/**
 * Strict citation check: every validateCitation() rule, plus the window must lie FULLY inside the claim
 * window (float slack EPS). A clip that runs past the claim would let time outside the claim change the
 * score, so strict callers (selected citations, clamped agent checks) must reject it. A request with no
 * clipId yet is checked as if it had one; an explicit blank clipId is still rejected.
 * validateCitation() and audit() keep their existing, overlap-only behaviour.
 */
export function validateCitationWithinClaim(claim: Claim, cited: CitationRequest): CitationCheck {
  const base = validateCitation(claim, {
    camera: cited?.camera,
    window: cited?.window,
    source: cited?.source,
    clipId: cited?.clipId === undefined ? "(not cut yet)" : cited.clipId,
    visible: 0, // not read by validateCitation()
    supports: null,
    contradicts: null,
  } as Evidence);
  if (!base.ok) return base;
  const [w0, w1] = cited.window;
  const [c0, c1] = claim.window;
  if (w0 < c0 - EPS || w1 > c1 + EPS)
    return { ok: false, reason: `cited window ${fmtW(cited.window)} must lie inside the claim window ${fmtW(claim.window)}` };
  return { ok: true };
}

function assertCitation(claim: Claim, cited: Evidence): void {
  const r = validateCitation(claim, cited);
  if (!r.ok) throw new AuditInputError(r.reason);
}

const abstain = (cited: Evidence): Audit => ({ supportScore: null, contradictScore: null, clipId: cited.clipId });

// ---------- route 1: checkWindow() ----------

const prob = z.number().finite().min(0).max(1);
const CheckedEvidenceSchema = z.object({
  camera: z.enum(["A", "B", "C", "D"]),
  window: z.tuple([z.number().finite(), z.number().finite()]),
  visible: prob,
  supports: prob.nullable(),
  contradicts: prob.nullable(),
  clipId: z.string().min(1),
  source: z.enum(["initial", "investigator", "skeptic"]),
});

/**
 * Independent audit of one cited window through Dev 1's checkWindow().
 * Throws AuditInputError (bad citation, nothing called), AuditUnavailableError (clip/model unreachable),
 * AuditResponseError (malformed or mismatched answer). Unusable views abstain with null scores.
 */
export async function audit(claim: Claim, cited: Evidence): Promise<Audit> {
  assertCitation(claim, cited);
  if (!(finite(cited.visible) && cited.visible >= THRESHOLDS.USABLE)) return abstain(cited);

  let raw: unknown;
  try {
    raw = await checkWindow({
      sceneId: claim.sceneId,
      camera: cited.camera,
      window: [cited.window[0], cited.window[1]],
      crop: "full",
      claim,
      source: cited.source,
    });
  } catch (cause) {
    throw new AuditUnavailableError(`cited clip ${cited.camera} ${fmtW(cited.window)} could not be checked`, { cause });
  }

  const parsed = CheckedEvidenceSchema.safeParse(raw);
  if (!parsed.success) throw new AuditResponseError(`checkWindow returned malformed evidence: ${parsed.error.issues[0]?.message}`);
  const e = parsed.data;
  if (e.camera !== cited.camera) throw new AuditResponseError(`checkWindow answered for camera ${e.camera}, not ${cited.camera}`);
  if (Math.abs(e.window[0] - cited.window[0]) > EPS || Math.abs(e.window[1] - cited.window[1]) > EPS)
    throw new AuditResponseError(`checkWindow answered for ${fmtW(e.window)}, not the cited ${fmtW(cited.window)}`);

  if (e.visible < THRESHOLDS.USABLE) return abstain(cited);
  return { supportScore: e.supports, contradictScore: e.contradicts, clipId: cited.clipId };
}

// ---------- route 2: Decisions API helpers ----------

function quoteClaim(text: string): string {
  const t = text.replace(/["“”`]/g, "'").replace(/\s+/g, " ").trim();
  return t.length > MAX_QUESTION_CLAIM_CHARS ? `${t.slice(0, MAX_QUESTION_CLAIM_CHARS)}...` : t;
}

/** Three independent yes/no questions ("noul" is the shared client's yes/no kind) about one clip. */
export function auditQuestions(claim: Claim): DecisionQuestion[] {
  const c = quoteClaim(claim.text);
  const obj = quoteClaim(claim.object);
  return [
    { id: AUDIT_QUESTION_IDS.support, kind: "noul", text: `Does this clip show that the following happened: "${c}"?` },
    {
      id: AUDIT_QUESTION_IDS.contradict,
      kind: "noul",
      text: `Does this clip clearly show something incompatible with: "${c}"? If the event is just not shown, answer no.`,
    },
    {
      id: AUDIT_QUESTION_IDS.visible,
      kind: "noul",
      text: `Is the ${obj} clearly visible in this clip, without occlusion, so the claim could be judged?`,
    },
  ];
}

/** Maps a decide() answer to an Audit. Malformed or missing answers throw; nothing becomes 0. */
export function scoreAuditDecision(raw: Record<string, number | Record<string, number>>, cited: Evidence): Audit {
  const get = (id: string): number => {
    const v = raw?.[id];
    if (!finite(v) || v < 0 || v > 1) throw new AuditResponseError(`decision "${id}" is missing or not a probability`);
    return v;
  };
  const support = get(AUDIT_QUESTION_IDS.support);
  const contradict = get(AUDIT_QUESTION_IDS.contradict);
  const visible = get(AUDIT_QUESTION_IDS.visible);
  if (visible < THRESHOLDS.USABLE) return abstain(cited);
  return { supportScore: support, contradictScore: contradict, clipId: cited.clipId };
}

/**
 * Decisions-API audit for a caller that already holds the cited clip as model parts.
 * PENDING: no repo interface resolves a clipId to parts yet. Plain strings are refused as media so a
 * clip id can never pose as video.
 */
export async function auditWithMedia(claim: Claim, cited: Evidence, media: unknown[]): Promise<Audit> {
  assertCitation(claim, cited);
  if (!Array.isArray(media) || media.length === 0 || media.some((p) => typeof p === "string" || p === null || typeof p !== "object"))
    throw new AuditUnavailableError("no cited media parts were supplied");

  let raw: Record<string, number | Record<string, number>>;
  try {
    raw = await decide(media, auditQuestions(claim), { purpose: "auditor", sceneId: claim.sceneId });
  } catch (cause) {
    throw new AuditUnavailableError("decide() failed for the cited clip", { cause });
  }
  return scoreAuditDecision(raw, cited);
}

// ---------- selected citations ----------

const CandidateSchema = z.object({
  camera: z.enum(["A", "B", "C", "D"]),
  window: z.tuple([z.number().finite(), z.number().finite()]),
  clipId: z.string().trim().min(1),
  goal: z.enum(["support", "contradict"]),
  sourceEvidenceClipId: z.string().min(1),
  basis: z.object({
    slices: z.number().finite(),
    partialSlices: z.number().finite(),
    goalSlices: z.number().finite(),
    minVisible: prob,
    gridStatistic: prob,
  }),
  verified: z.literal(false),
});

/**
 * Audits a window chosen by selectCitation() (lib/inference/citation.ts) through the same audit() path.
 * The candidate carries no support/contradiction score, so the audit input passes null for both
 * (audit() never reads them) and the window's OBSERVED minimum visibility for the abstain gate. This
 * input is internal: it is never returned and must not be added to ClaimResult.evidence. The returned
 * Audit keeps the candidate's own grid clipId, consistent with audit().
 */
export async function auditCitation(claim: Claim, candidate: CitationCandidate): Promise<Audit> {
  const c = CandidateSchema.safeParse(candidate);
  if (!c.success) throw new AuditInputError(`invalid citation candidate: ${c.error.issues[0]?.message ?? "invalid"}`);
  // Selected citations must lie fully inside the claim (selectCitation() clamps them); reject anything else.
  const strict = validateCitationWithinClaim(claim, {
    camera: c.data.camera,
    window: [c.data.window[0], c.data.window[1]],
    source: "initial",
    clipId: c.data.clipId,
  });
  if (!strict.ok) throw new AuditInputError(strict.reason);
  const input: Evidence = {
    camera: c.data.camera,
    window: [c.data.window[0], c.data.window[1]],
    visible: c.data.basis.minVisible,
    supports: null,
    contradicts: null,
    clipId: c.data.clipId,
    source: "initial",
  };
  return audit(claim, input);
}
