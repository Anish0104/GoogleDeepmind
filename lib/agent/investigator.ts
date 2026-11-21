// OWNER: Dev 3. Fills gaps: runs when a label is Insufficient (including when two usable cameras disagree).
// Refuses (does not throw) on any claim eligibleAgent() doesn't assign to the investigator.
import type { Claim } from "@/lib/types";
import { startAgent, type AgentOutcome, type StartAgentDeps } from "@/lib/agent/start";

export type { AgentOutcome, StartAgentDeps };

/** Runs the Investigator on one claim (stand-in mode by default). */
export async function investigate(claim: Claim, sceneId: string, deps: StartAgentDeps = {}): Promise<AgentOutcome> {
  return startAgent("investigator", claim, sceneId, deps);
}
