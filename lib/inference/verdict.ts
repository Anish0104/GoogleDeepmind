// OWNER: Dev 2. SHIP FIRST (with tests): Dev 3 uses these.
// The ONLY place a label is set. Rules: docs/DEV2-reasoning-core.md. Thresholds: THRESHOLDS in lib/config.ts.
import type { Audit, Claim, ClaimResult, Evidence, Verdict } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export function verdict(_evidence: Evidence[], _claim: Claim, _audit: Audit | null): Verdict {
  return notImplemented("Dev 2", "verdict");
}

/** Skeptic results: keep the old label unless the new one is Insufficient; log blocked changes. */
export function enforceDowngradeOnly(_prev: ClaimResult, _next: Verdict, _reason: string): ClaimResult {
  return notImplemented("Dev 2", "enforceDowngradeOnly");
}

/** True when a Supported label rests on one usable camera or a score within WEAK_SUPPORT_MARGIN of a threshold. */
export function isWeakSupport(_result: ClaimResult, _claim: Claim): boolean {
  return notImplemented("Dev 2", "isWeakSupport");
}
