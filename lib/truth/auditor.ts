// OWNER: Dev 2. Decision 1 sees ONLY the cited clip and the claim (through Dev 1's checkWindow()).
import type { Audit, Claim, Evidence } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function audit(_claim: Claim, _cited: Evidence): Promise<Audit> {
  return notImplemented("Dev 2", "audit");
}
