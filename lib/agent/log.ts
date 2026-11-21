// OWNER: Dev 3. investigation_log.md in the agent environment (copied to data/scenes/<id>/),
// plus agent-steps.jsonl for the board's agent trace.
import type { AgentStep } from "@/lib/types";
import { appendJsonl } from "@/lib/store/scene";

export const AGENT_STEPS_FILE = "agent-steps.jsonl";

/** Appends one AgentStep to data/scenes/<sceneId>/agent-steps.jsonl. */
export async function logStep(sceneId: string, step: AgentStep): Promise<void> {
  await appendJsonl(sceneId, AGENT_STEPS_FILE, step);
}

// TODO(Dev 3, at the event): copy investigation_log.md out of the managed-agent environment once the
// Interactions API field names for environment files are confirmed. Not needed for the stand-in.
