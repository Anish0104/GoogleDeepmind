// OWNER: Dev 4. Pure helpers for the landing page: HUD timing and verdict examples.
import type { Claim, ClaimResult, Verdict } from "@/lib/types";

/** HUD cycle: 125 ticks (5 s at 25 ticks/s) per claim, looping through the claims. */
export function hudFrame(
  tick: number,
  claimCount: number,
): { index: number; chars: number; bars: boolean; stamped: boolean } {
  const loc = tick % 125;
  return {
    index: claimCount > 0 ? Math.floor(tick / 125) % claimCount : 0,
    chars: Math.floor(loc * 1.4),
    bars: loc > 40,
    stamped: loc > 70,
  };
}

/** The example claim for a verdict tile: the first claim whose first label is that verdict. */
export function exampleFor(v: Verdict, claims: Claim[], results: ClaimResult[]): { claim: string; reason: string } | null {
  for (const c of claims) {
    const r = results.find((x) => x.claimId === c.id);
    const first = r?.history[0];
    if (first && first.to === v) return { claim: c.text, reason: first.reason };
  }
  return null;
}

