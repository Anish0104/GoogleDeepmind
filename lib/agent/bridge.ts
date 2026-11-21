// OWNER: Dev 3. Validates every agent tool call, then cuts the clip locally and scores it.
// Reject unless: camera in includedCameras; window inside allowedRangeS, CLIP_MIN_S-CLIP_MAX_S long and
// overlapping the claim window;
// not already checked; followUpsLeft > 0. A rejection is returned with its reason and still uses a check.
import { z } from "zod";
import { LIMITS } from "@/lib/config";
import type { AgentMenu, CameraId, Claim, Evidence, InspectWindowArgs, StopArgs } from "@/lib/types";
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

/**
 * Checks the window's own rules only: camera included, finite times, inside allowedRangeS,
 * CLIP_MIN_S-CLIP_MAX_S long, overlapping the claim window. Ignores follow-ups and already-checked windows.
 */
export function validateWindow(args: InspectWindowArgs, menu: AgentMenu): Validation {
  const { camera_id: camera, start_s: start, end_s: end } = args;
  const window: [number, number] = [start, end];

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
  // The clip may extend into the padding (allowedRangeS) but must share some time with the claim window;
  // the auditor rejects citations that don't overlap it. Touching an edge is not overlapping.
  const [c0, c1] = menu.claim.window;
  if (!(start < c1 - EPS && c0 < end - EPS)) {
    return reject(`Clip must overlap the claim window ${c0}–${c1} s.`);
  }
  return { ok: true };
}

/** The first already-checked window on the same camera that overlaps this one (touching edges don't count). */
export function findOverlap(
  camera: CameraId,
  window: [number, number],
  alreadyChecked: AgentMenu["alreadyChecked"],
): AgentMenu["alreadyChecked"][number] | undefined {
  const [start, end] = window;
  return alreadyChecked.find(
    (c) => c.camera === camera && start < c.window[1] - EPS && c.window[0] < end - EPS,
  );
}

/** Checks a parsed inspect_window call against the menu. Returns the first rule it breaks. */
export function validate(args: InspectWindowArgs, menu: AgentMenu): Validation {
  if (!(menu.followUpsLeft > 0)) {
    return reject("No follow-ups left: the check budget for this claim is used up.");
  }
  const own = validateWindow(args, menu);
  if (!own.ok) return own;

  const window: [number, number] = [args.start_s, args.end_s];
  const clash = findOverlap(args.camera_id, window, menu.alreadyChecked);
  if (clash) {
    return reject(
      `Camera ${args.camera_id} ${fmt(window)} overlaps ${fmt(clash.window)}, which was already checked.`,
    );
  }
  return { ok: true };
}

// ---------- tool-call parsing ----------

export type ToolCall = { name: "inspect_window"; args: InspectWindowArgs } | { name: "stop"; args: StopArgs };

/** droppedFields lists unknown argument keys that were stripped, so the step log can report them. */
export type ParsedToolCall =
  | { ok: true; call: ToolCall; droppedFields: string[] }
  | { ok: false; reason: string; droppedFields: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type ArgsResult<T> = { ok: true; args: T } | { ok: false; reason: string };

function parseArgs<T>(
  name: string,
  schema: z.ZodObject & z.ZodType<T>,
  raw: unknown,
): ArgsResult<T> & { droppedFields: string[] } {
  const known = new Set(Object.keys(schema.shape));
  const droppedFields = isPlainObject(raw) ? Object.keys(raw).filter((k) => !known.has(k)) : [];
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, args: parsed.data, droppedFields };
  const issues = parsed.error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "arguments"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason: `Invalid ${name} arguments: ${issues}.`, droppedFields };
}

/** Parses a raw tool call from a model with zod. Never throws. */
export function parseToolCall(name: string, raw: unknown): ParsedToolCall {
  if (name === "inspect_window") {
    const r = parseArgs<InspectWindowArgs>(name, InspectWindowArgsSchema, raw);
    return r.ok ? { ok: true, call: { name, args: r.args }, droppedFields: r.droppedFields } : r;
  }
  if (name === "stop") {
    const r = parseArgs<StopArgs>(name, StopArgsSchema, raw);
    return r.ok ? { ok: true, call: { name, args: r.args }, droppedFields: r.droppedFields } : r;
  }
  return { ok: false, reason: `Unknown tool "${name}". Use inspect_window or stop.`, droppedFields: [] };
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
