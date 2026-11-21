// OWNER: Dev 3. Attacks conclusions: runs on every Contradicted label, and on Supported only when
// isWeakSupport() is true. Can only downgrade to Insufficient (enforceDowngradeOnly), never create Contradicted.
import type { Claim } from "@/lib/types";
import type { AgentRun } from "@/lib/agent/loop";
import { notImplemented } from "@/lib/not-implemented";

export async function challenge(_claim: Claim, _sceneId: string): Promise<AgentRun> {
  return notImplemented("Dev 3", "challenge");
}
