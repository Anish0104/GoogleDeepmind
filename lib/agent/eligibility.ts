// OWNER: Dev 3. Which agent may run on a claim. Shared by investigator.ts, skeptic.ts and the pipeline runner.
// Investigator: undecided claims. Skeptic: decided claims worth attacking (every Contradicted, weak Supported).
// Decided labels only ever go to the Skeptic, whose results pass through enforceDowngradeOnly().
import { THRESHOLDS } from "@/lib/config";
import { isWeakSupport } from "@/lib/inference/verdict";
import { overlaps } from "@/lib/inference/window";
import type { AgentName, CameraId, Claim, ClaimResult, Evidence } from "@/lib/types";

/** Evidence from cameras that are not excluded. Applied before every verdict() and eligibility decision. */
export function withoutExcluded(evidence: Evidence[], excludedCameras: readonly CameraId[]): Evidence[] {
  if (excludedCameras.length === 0) return evidence;
  const excluded = new Set(excludedCameras);
  return evidence.filter((e) => !excluded.has(e.camera));
}

/** True when one usable camera supports at CLEAR and a different usable camera contradicts at CLEAR. */
export function camerasDisagree(result: ClaimResult, claim: Claim): boolean {
  const usable = result.evidence.filter(
    (e) => e.visible >= THRESHOLDS.USABLE && overlaps(e.window, claim.window),
  );
  const supporting = new Set(usable.filter((e) => (e.supports ?? 0) >= THRESHOLDS.CLEAR).map((e) => e.camera));
  return usable.some((e) => (e.contradicts ?? 0) >= THRESHOLDS.CLEAR && [...supporting].some((c) => c !== e.camera));
}

export interface Eligibility {
  agent: AgentName | null;
  reason: string;
}

/** The agent allowed to run on this claim and why, or agent: null with the reason none is. */
export function explainEligibility(result: ClaimResult, claim: Claim): Eligibility {
  switch (result.verdict) {
    case "Insufficient":
      return {
        agent: "investigator",
        reason: camerasDisagree(result, claim)
          ? "Insufficient: two usable cameras disagree."
          : "Insufficient: the footage so far does not settle the claim.",
      };
    case "Contradicted":
      return { agent: "skeptic", reason: "Contradicted: every Contradicted label is challenged." };
    case "Supported":
      return isWeakSupport(result, claim)
        ? { agent: "skeptic", reason: "Weak Supported: rests on one camera or a score near a threshold." }
        : { agent: null, reason: "Strong Supported: neither agent runs." };
  }
}

/**
 * "investigator" for Insufficient (including when two usable cameras disagree), "skeptic" for Contradicted
 * or weak Supported (Dev 2's isWeakSupport()), null for strong Supported.
 */
export function eligibleAgent(result: ClaimResult, claim: Claim): AgentName | null {
  return explainEligibility(result, claim).agent;
}
