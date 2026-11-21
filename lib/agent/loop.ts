// OWNER: Dev 3. The loop both agents share: at most LIMITS.AGENT_MAX_CHECKS checks, then a forced stop.
// After each result: verdict() recomputes; the Skeptic's result also goes through enforceDowngradeOnly().
import type { AgentName, AgentStep, Claim, ClaimResult } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface AgentRun {
  result: ClaimResult;
  steps: AgentStep[];
}

export async function runAgent(
  _agent: AgentName,
  _claim: Claim,
  _sceneId: string,
  _mode: "managed" | "standin",
): Promise<AgentRun> {
  return notImplemented("Dev 3", "runAgent");
}
