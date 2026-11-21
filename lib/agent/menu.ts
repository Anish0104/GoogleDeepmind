// OWNER: Dev 3. Builds the ONLY thing an agent sees: the allowlisted menu plus stills and view descriptions.
// Reads views.json and stills.json (camera -> still id). Never reads labels/, scripts/, ground truth, other
// claims' results or anything from excluded cameras.
import { z } from "zod";
import { LIMITS } from "@/lib/config";
import { NotFoundError, readJson } from "@/lib/store/scene";
import type {
  AgentMenu,
  AgentName,
  CameraId,
  Claim,
  ClaimResult,
  Evidence,
  InspectWindowArgs,
  SceneManifest,
} from "@/lib/types";
import { findOverlap, validateWindow } from "@/lib/agent/bridge";

const CameraIdSchema = z.enum(["A", "B", "C", "D"]);
const ViewsSchema = z.array(z.object({ camera: CameraIdSchema, text: z.string() }));
const StillsSchema = z.partialRecord(CameraIdSchema, z.string());

/** Optional scene file: a missing file is the empty value; a malformed one throws. */
async function readOptional<T>(sceneId: string, file: string, schema: z.ZodType<T>, empty: T): Promise<T> {
  try {
    return await readJson(sceneId, file, schema);
  } catch (e) {
    if (e instanceof NotFoundError) return empty;
    throw e;
  }
}

/**
 * Builds the allowlisted menu for one agent on one claim. Allowlist, not blocklist: every field is built
 * explicitly from the claim, its own result (label + evidence only) and views.json / stills.json, all filtered
 * to included cameras. Never reads other claims' results, labels/, scripts/ or ground truth.
 */
export async function buildMenu(
  agent: AgentName,
  claim: Claim,
  result: ClaimResult,
  manifest: SceneManifest,
): Promise<AgentMenu> {
  if (claim.sceneId !== manifest.sceneId) {
    throw new Error(`Claim ${claim.id} belongs to scene ${claim.sceneId}, not ${manifest.sceneId}.`);
  }
  if (result.claimId !== claim.id) throw new Error(`Result is for claim ${result.claimId}, not ${claim.id}.`);

  const excluded = new Set<CameraId>(manifest.excludedCameras);
  const includedCameras = manifest.cameras.filter((c) => !excluded.has(c));
  const included = new Set<CameraId>(includedCameras);

  const [views, stills] = await Promise.all([
    readOptional(manifest.sceneId, "views.json", ViewsSchema, []),
    readOptional(manifest.sceneId, "stills.json", StillsSchema, {}),
  ]);

  const evidence: Evidence[] = result.evidence.filter((e) => included.has(e.camera)).map((e) => ({ ...e }));
  const stillIds: AgentMenu["stillIds"] = {};
  for (const c of includedCameras) {
    const id = stills[c];
    if (id !== undefined) stillIds[c] = id;
  }

  const [w0, w1] = claim.window;
  const pad = LIMITS.AGENT_RANGE_PAD_S;
  const lo = Math.max(0, w0 - pad);
  const hi = manifest.durationS > 0 ? Math.min(manifest.durationS, w1 + pad) : w1 + pad;

  return {
    agent,
    claim: { ...claim, window: [w0, w1] },
    currentVerdict: result.verdict,
    evidence,
    views: views.filter((v) => included.has(v.camera)).map(({ camera, text }) => ({ camera, text })),
    stillIds,
    includedCameras,
    allowedRangeS: [lo, hi],
    alreadyChecked: evidence.map((e) => ({ camera: e.camera, window: [e.window[0], e.window[1]] })),
    followUpsLeft: LIMITS.AGENT_MAX_CHECKS,
  };
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
