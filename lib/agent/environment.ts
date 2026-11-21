// OWNER: Dev 3. One Gemini Managed Agent environment per scene, created at scene start so it's warm.
// Interactions API: agent MODELS.AGENT_ID, environment "remote", tools = only inspect_window and stop,
// no network, agent_config.max_total_tokens = LIMITS.AGENT_MAX_TOTAL_TOKENS.
// Confirm exact field names at 10:30. Managed agents may need event credits: use standin.ts until then.
import { notImplemented } from "@/lib/not-implemented";

export interface AgentEnvironment {
  sceneId: string;
  environmentId: string;
  createdAt: string;
}

export async function createEnvironment(_sceneId: string): Promise<AgentEnvironment> {
  return notImplemented("Dev 3", "createEnvironment");
}

export async function getEnvironment(_sceneId: string): Promise<AgentEnvironment | null> {
  return notImplemented("Dev 3", "getEnvironment");
}
