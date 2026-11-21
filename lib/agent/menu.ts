// OWNER: Dev 3. Builds the ONLY thing an agent sees: the allowlisted menu plus stills and view descriptions.
// Reads results.json, views.json and stills/. Never reads labels/, scripts/, ground truth or excluded cameras.
import type { AgentMenu, AgentName, Claim, ClaimResult, Evidence, InspectWindowArgs, SceneManifest } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function buildMenu(
  _agent: AgentName,
  _claim: Claim,
  _result: ClaimResult,
  _manifest: SceneManifest,
): Promise<AgentMenu> {
  return notImplemented("Dev 3", "buildMenu");
}

/** Uses up one follow-up and marks the window as checked (also for rejected calls). */
export function consume(_menu: AgentMenu, _args: InspectWindowArgs, _evidence: Evidence | null): AgentMenu {
  return notImplemented("Dev 3", "consume");
}
