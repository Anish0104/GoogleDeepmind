// OWNER: Dev 3. Validates every agent tool call, then cuts the clip locally and scores it.
// Reject unless: camera in includedCameras; window inside allowedRangeS and CLIP_MIN_S-CLIP_MAX_S long;
// not already checked; followUpsLeft > 0. A rejection is returned with its reason and still uses a check.
import { z } from "zod";
import { LIMITS } from "@/lib/config";
import type { AgentMenu, Claim, Evidence, InspectWindowArgs, StopArgs } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

/** Slack for float rounding on window edges and lengths (e.g. 10.1 + 4 - 10.1 !== 4). */
const EPS = 1e-6;

const seconds = z.number().finite().nonnegative();
const reason = z.string().trim().min(1);

/** Agent's inspect_window arguments. Unknown keys are stripped; validate() checks them against the menu. */
export const InspectWindowArgsSchema = z.object({
  camera_id: z.enum(["A", "B", "C", "D"]),
  start_s: seconds,
  end_s: seconds,
  crop: z.enum(["full", "entity"]),
  reason,
}) satisfies z.ZodType<InspectWindowArgs>;

export const StopArgsSchema = z.object({ reason }) satisfies z.ZodType<StopArgs>;

export type Validation = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): Validation => ({ ok: false, reason });
const fmt = (w: [number, number]) => `[${w[0]}, ${w[1]}] s`;

/** Checks a parsed inspect_window call against the menu. Returns the first rule it breaks. */
export function validate(args: InspectWindowArgs, menu: AgentMenu): Validation {
  const { camera_id: camera, start_s: start, end_s: end } = args;
  const window: [number, number] = [start, end];

  if (!(menu.followUpsLeft > 0)) {
    return reject("No follow-ups left: the check budget for this claim is used up.");
  }
  if (!menu.includedCameras.includes(camera)) {
    return reject(
      `Camera ${camera} is not available. Allowed cameras: ${menu.includedCameras.join(", ") || "none"}.`,
    );
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return reject("start_s and end_s must be finite numbers.");
  }
  const [lo, hi] = menu.allowedRangeS;
  if (start < lo - EPS || end > hi + EPS) {
    return reject(`Window ${fmt(window)} is outside the allowed range ${fmt(menu.allowedRangeS)}.`);
  }
  const length = end - start;
  if (length < LIMITS.CLIP_MIN_S - EPS || length > LIMITS.CLIP_MAX_S + EPS) {
    return reject(
      `Window ${fmt(window)} is ${Number(length.toFixed(3))} s long; it must be ` +
        `${LIMITS.CLIP_MIN_S}-${LIMITS.CLIP_MAX_S} s long.`,
    );
  }
  const clash = menu.alreadyChecked.find(
    (c) => c.camera === camera && start < c.window[1] - EPS && c.window[0] < end - EPS,
  );
  if (clash) {
    return reject(
      `Camera ${camera} ${fmt(window)} overlaps ${fmt(clash.window)}, which was already checked.`,
    );
  }
  return { ok: true };
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
