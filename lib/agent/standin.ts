// OWNER: Dev 3. An ordinary model call with the same two tools (inspect_window, stop).
// Used for development on the free tier and as the "ordinary model call" in the agent comparison.
import type { AgentMenu } from "@/lib/types";
import type { ToolCall } from "@/lib/agent/bridge";
import { notImplemented } from "@/lib/not-implemented";

export type { ToolCall };

export async function standinTurn(_systemPrompt: string, _menu: AgentMenu, _history: unknown[]): Promise<ToolCall> {
  return notImplemented("Dev 3", "standinTurn");
}
