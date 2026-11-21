// OWNER: Dev 3. Attacks conclusions: runs on every Contradicted label, and on Supported only when
// isWeakSupport() is true. Can only downgrade to Insufficient (enforceDowngradeOnly), never create Contradicted.
// Refuses (does not throw) on any claim eligibleAgent() doesn't assign to the skeptic.
import type { Claim } from "@/lib/types";
import { startAgent, type AgentOutcome, type StartAgentDeps } from "@/lib/agent/start";

export type { AgentOutcome, StartAgentDeps };

/** Runs the Skeptic on one claim (stand-in mode by default). */
export async function challenge(claim: Claim, sceneId: string, deps: StartAgentDeps = {}): Promise<AgentOutcome> {
  return startAgent("skeptic", claim, sceneId, deps);
}
