// OWNER: Dev 3. What the agent is told about clip windows, shared by the stand-in and the managed agent:
// the menu as shown (with claimWindowS), and feedback on a rejected call (the claim window plus a window that
// would pass). Text only: the bridge's validate() is unchanged, and every example is checked against it.
import { LIMITS } from "@/lib/config";
import type { AgentMenu, AgentStep, CameraId } from "@/lib/types";
import { validate } from "@/lib/agent/bridge";

/**
 * The menu as the agent sees it: the AgentMenu fields (listed explicitly, so a field added to the type later
 * is not shown until it is added here), plus claimWindowS right after allowedRangeS.
 */
export function menuForAgent(menu: AgentMenu): AgentMenu & { claimWindowS: [number, number] } {
  const { agent, claim, currentVerdict, evidence, views, stillIds, includedCameras, allowedRangeS, alreadyChecked, followUpsLeft } = menu;
  const claimWindowS: [number, number] = [claim.window[0], claim.window[1]];
  return { agent, claim, currentVerdict, evidence, views, stillIds, includedCameras, allowedRangeS, claimWindowS, alreadyChecked, followUpsLeft };
}

export interface ExampleWindow {
  camera_id: CameraId;
  start_s: number;
  end_s: number;
}

/** The claim window as a clip: cut to CLIP_MAX_S, or stretched to CLIP_MIN_S inside allowedRangeS. */
function claimClip(menu: AgentMenu): [number, number] {
  const [w0, w1] = menu.claim.window;
  const [lo, hi] = menu.allowedRangeS;
  if (w1 - w0 > LIMITS.CLIP_MAX_S) return [w0, w0 + LIMITS.CLIP_MAX_S];
  if (w1 - w0 >= LIMITS.CLIP_MIN_S) return [w0, w1];
  const end = Math.min(hi, w0 + LIMITS.CLIP_MIN_S);
  return [Math.max(lo, end - LIMITS.CLIP_MIN_S), end];
}

/**
 * A clip that would pass validate() right now: the claim window on `prefer` if that works, otherwise on the
 * first included camera where it does. null if no included camera has a valid clip over the claim window.
 */
export function exampleWindow(menu: AgentMenu, prefer?: CameraId): ExampleWindow | null {
  const [start_s, end_s] = claimClip(menu);
  const cameras = [...(prefer && menu.includedCameras.includes(prefer) ? [prefer] : []), ...menu.includedCameras];
  const live = { ...menu, followUpsLeft: Math.max(1, menu.followUpsLeft) }; // the example is about the window
  for (const camera_id of cameras) {
    if (validate({ camera_id, start_s, end_s, crop: "full", reason: "example" }, live).ok) return { camera_id, start_s, end_s };
  }
  return null;
}

export interface RejectionFeedback {
  error: string;
  claimWindowS: [number, number];
  validExample?: ExampleWindow;
}

/** What goes back to the agent for a rejected call: the bridge's reason, the claim window, a valid example. */
export function rejectionFeedback(step: AgentStep, menu: AgentMenu): RejectionFeedback {
  const asked = "camera_id" in step.args ? step.args.camera_id : undefined;
  const example = exampleWindow(menu, asked);
  return {
    error: step.rejectionReason ?? "The call was not run.",
    claimWindowS: [menu.claim.window[0], menu.claim.window[1]],
    ...(example ? { validExample: example } : {}),
  };
}
