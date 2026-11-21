// OWNER: Dev 2. SHIP FIRST (with tests): Dev 3 uses these.
// The ONLY place a label is set. Rules: docs/DEV2-reasoning-core.md. Thresholds: THRESHOLDS in lib/config.ts.
import type { Audit, CameraId, Claim, ClaimResult, Evidence, Verdict } from "@/lib/types";
import { THRESHOLDS } from "@/lib/config";
import { covers, overlaps } from "@/lib/inference/window";

const { USABLE, CLEAR, DECISIVE, WEAK_SUPPORT_MARGIN } = THRESHOLDS;

/**
 * A usable view "takes a side" (and so blocks the opposite label) at CLEAR or more.
 * Support needs CLEAR to count, so a contradiction at CLEAR is just as strong a dissent.
 */
const DISSENT = CLEAR;

/** Float slack for "within WEAK_SUPPORT_MARGIN" so that CLEAR + MARGIN itself counts as weak. */
const MARGIN_EPS = 1e-9;

/** A score is only a score if it is a finite number; null, NaN and Infinity mean "no reading". */
function score(x: number | null | undefined): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function atLeast(x: number | null | undefined, threshold: number): boolean {
  const s = score(x);
  return s !== null && s >= threshold;
}

/** Evidence that counts for this claim: usable visibility and overlapping the claim's window. */
function usableInWindow(evidence: readonly Evidence[], claim: Claim): Evidence[] {
  return evidence.filter((e) => atLeast(e.visible, USABLE) && overlaps(e.window, claim.window));
}

/**
 * The single source of every label. Each camera is judged on its own; scores are never averaged.
 *
 * - Supported: a usable view supports >= CLEAR, no usable view contradicts >= CLEAR,
 *   audit supportScore >= CLEAR and audit contradictScore < CLEAR.
 * - Contradicted: a usable view contradicts >= DECISIVE, no usable view supports >= CLEAR,
 *   audit contradictScore >= DECISIVE and audit supportScore < CLEAR, and for a vague-time claim
 *   usable views cover the whole claim window.
 * - Everything else: Insufficient. A low score or an unseen event never means Contradicted.
 */
export function verdict(evidence: Evidence[], claim: Claim, audit: Audit | null): Verdict {
  const usable = usableInWindow(evidence, claim);
  if (usable.length === 0 || audit === null) return "Insufficient";

  const anySupport = usable.some((e) => atLeast(e.supports, CLEAR));
  const anyDissentAgainstSupport = usable.some((e) => atLeast(e.contradicts, DISSENT));
  const anyDecisiveContradiction = usable.some((e) => atLeast(e.contradicts, DECISIVE));
  const anyDissentAgainstContradiction = usable.some((e) => atLeast(e.supports, DISSENT));

  const auditSupports = atLeast(audit.supportScore, CLEAR);
  const auditDissentsFromSupport = atLeast(audit.contradictScore, DISSENT);
  const auditContradicts = atLeast(audit.contradictScore, DECISIVE);
  const auditDissentsFromContradiction = atLeast(audit.supportScore, DISSENT);

  if (anySupport && !anyDissentAgainstSupport && auditSupports && !auditDissentsFromSupport) {
    return "Supported";
  }

  if (anyDecisiveContradiction && !anyDissentAgainstContradiction && auditContradicts && !auditDissentsFromContradiction) {
    if (claim.timeIsPrecise) return "Contradicted";
    const seen = usable.map((e) => e.window);
    return covers(seen, claim.window) ? "Contradicted" : "Insufficient";
  }

  return "Insufficient";
}

/**
 * Skeptic results: keep the old label unless the new one is Insufficient; log blocked changes.
 * The Skeptic can only remove a label, never create or flip one. Returns a new ClaimResult.
 */
export function enforceDowngradeOnly(prev: ClaimResult, next: Verdict, reason: string): ClaimResult {
  if (next === prev.verdict) {
    return { ...prev, history: [...prev.history] };
  }
  const at = new Date().toISOString();
  if (next === "Insufficient") {
    return {
      ...prev,
      verdict: "Insufficient",
      history: [...prev.history, { from: prev.verdict, to: next, by: "skeptic", reason, at }],
    };
  }
  return {
    ...prev,
    history: [...prev.history, { from: prev.verdict, to: next, by: "skeptic", blocked: true, reason, at }],
  };
}

function nearThreshold(x: number | null | undefined, threshold: number): boolean {
  const s = score(x);
  return s === null || s <= threshold + WEAK_SUPPORT_MARGIN + MARGIN_EPS;
}

/**
 * True when a Supported label rests on one usable camera or a score within WEAK_SUPPORT_MARGIN of a threshold.
 * Weak when any of:
 * - fewer than two distinct usable cameras support at CLEAR or more;
 * - the strongest supporting camera is within the margin of CLEAR;
 * - the audit support score is missing or within the margin of CLEAR;
 * - every supporting camera's visibility is within the margin of USABLE;
 * - a usable camera contradicts within the margin below the dissent threshold.
 */
export function isWeakSupport(result: ClaimResult, claim: Claim): boolean {
  if (result.verdict !== "Supported") return false;

  const usable = usableInWindow(result.evidence, claim);
  const supporting = usable.filter((e) => atLeast(e.supports, CLEAR));

  const cameras = new Set<CameraId>(supporting.map((e) => e.camera));
  if (cameras.size < 2) return true;

  const best = Math.max(...supporting.map((e) => score(e.supports) ?? 0));
  if (nearThreshold(best, CLEAR)) return true;

  if (result.audit === null || nearThreshold(result.audit.supportScore, CLEAR)) return true;

  if (supporting.every((e) => nearThreshold(e.visible, USABLE))) return true;

  if (usable.some((e) => atLeast(e.contradicts, DISSENT - WEAK_SUPPORT_MARGIN))) return true;

  return false;
}
