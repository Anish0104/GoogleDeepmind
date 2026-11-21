// OWNER: Dev 3. Builds the ONLY thing an agent sees: the allowlisted menu plus stills and view descriptions.
// Reads results.json, views.json and stills/. Never reads labels/, scripts/, ground truth or excluded cameras.
import type { AgentMenu, AgentName, Claim, ClaimResult, Evidence, InspectWindowArgs, SceneManifest } from "@/lib/types";
import { findOverlap, validateWindow } from "@/lib/agent/bridge";
import { notImplemented } from "@/lib/not-implemented";

export async function buildMenu(
  _agent: AgentName,
  _claim: Claim,
  _result: ClaimResult,
  _manifest: SceneManifest,
): Promise<AgentMenu> {
  return notImplemented("Dev 3", "buildMenu");
}

/**
 * Uses up one follow-up for every call, accepted or rejected (followUpsLeft never goes below 0).
 * Records the window in alreadyChecked only if follow-ups were left, it is well-formed (validateWindow) and it
 * doesn't overlap an already-checked window, so a malformed, overlapping or over-budget request costs a check
 * without blocking a real window.
 * Pass args = null for a call that failed schema parsing. Appends evidence when the check ran. Pure.
 */
export function consume(menu: AgentMenu, args: InspectWindowArgs | null, evidence: Evidence | null): AgentMenu {
  let alreadyChecked = menu.alreadyChecked;
  if (args && menu.followUpsLeft > 0 && validateWindow(args, menu).ok) {
    const window: [number, number] = [args.start_s, args.end_s];
    if (!findOverlap(args.camera_id, window, alreadyChecked)) {
      alreadyChecked = [...alreadyChecked, { camera: args.camera_id, window }];
    }
  }
  return {
    ...menu,
    followUpsLeft: Math.max(0, menu.followUpsLeft - 1),
    alreadyChecked,
    evidence: evidence ? [...menu.evidence, evidence] : menu.evidence,
  };
}
