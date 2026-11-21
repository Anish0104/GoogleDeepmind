// OWNER: Dev 3. investigation_log.md in the agent environment (copied to data/scenes/<id>/),
// plus agent-steps.jsonl for the board's agent trace.
import type { AgentStep } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function logStep(_sceneId: string, _step: AgentStep): Promise<void> {
  notImplemented("Dev 3", "logStep");
}
