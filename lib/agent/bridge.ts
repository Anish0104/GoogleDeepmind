// OWNER: Dev 3. Validates every agent tool call, then cuts the clip locally and scores it.
// Reject unless: camera in includedCameras; window inside allowedRangeS and CLIP_MIN_S-CLIP_MAX_S long;
// not already checked; followUpsLeft > 0. A rejection is returned with its reason and still uses a check.
import type { AgentMenu, Claim, Evidence, InspectWindowArgs } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export type Validation = { ok: true } | { ok: false; reason: string };

export function validate(_args: InspectWindowArgs, _menu: AgentMenu): Validation {
  return notImplemented("Dev 3", "validate");
}

/** Calls Dev 1's checkWindow() and Dev 2's auditor for a validated request. */
export async function inspect(
  _args: InspectWindowArgs,
  _claim: Claim,
  _sceneId: string,
  _source: Evidence["source"],
): Promise<Evidence> {
  return notImplemented("Dev 3", "inspect");
}
