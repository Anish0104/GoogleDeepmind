// OWNER: Dev 3. An ordinary model call with the same two tools (inspect_window, stop).
// Used for development on the free tier and as the "ordinary model call" in the agent comparison.
import type { AgentMenu, InspectWindowArgs, StopArgs } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export type ToolCall = { name: "inspect_window"; args: InspectWindowArgs } | { name: "stop"; args: StopArgs };

export async function standinTurn(_systemPrompt: string, _menu: AgentMenu, _history: unknown[]): Promise<ToolCall> {
  return notImplemented("Dev 3", "standinTurn");
}
