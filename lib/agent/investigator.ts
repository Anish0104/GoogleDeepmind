// OWNER: Dev 3. Fills gaps: runs when a label is Insufficient or two usable cameras disagree.
import type { Claim } from "@/lib/types";
import type { AgentRun } from "@/lib/agent/loop";
import { notImplemented } from "@/lib/not-implemented";

export async function investigate(_claim: Claim, _sceneId: string): Promise<AgentRun> {
  return notImplemented("Dev 3", "investigate");
}
