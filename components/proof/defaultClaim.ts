// OWNER: Dev 4.
import type { Claim, ClaimResult } from "@/lib/types";

/** The claim /proof opens on: the first Contradicted one, else the first claim. */
export function defaultProofClaim(claims: Claim[], results: ClaimResult[]): string | null {
  const contradicted = claims.find((c) => results.find((r) => r.claimId === c.id)?.verdict === "Contradicted");
  return contradicted?.id ?? claims[0]?.id ?? null;
}
