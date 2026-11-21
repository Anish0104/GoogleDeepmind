// OWNER: Dev 3. The scene run behind POST /api/scene/[id]/run. Every stage is injected (same pattern as runAgent),
// so tests use fakes; the defaults call each dev's real function exactly as it is.
//
// Order: probe -> perceive (Dev 1's perceiveScene(): sync -> slice -> scout -> lattice) -> stills.json, ending
// with run.json { status: "perceived" }. Labels are not made here: Dev 2's runAccount() (POST .../account) does
// claims -> grounding -> evidence -> citation -> audit -> verdict, and POST .../agents runs the agents.
// - probe records each included camera's recording (as a path relative to the scene folder) and the shortest
//   duration into manifest.json, before perceiveScene() reads it. Excluded cameras are never probed.
// - perceive gets, from the manifest and only when set: presynced (skip sync, zero offsets, no sync.json),
//   questions (QUESTION_SETS[questionSet] instead of scout's) with that set's motion question ids as
//   contextQuestionIds (QUESTION_SET_MOTION_IDS), and roi (crop slices to motion).
// - stills.json (camera -> middle still) is written from slices.json for the agents' menu; no model call.
// - assertBudget() runs before perceive (scout and lattice call Gemini); a budget stop is a clean failed status
//   with error "budget".
// - One run per scene: the store's scene lock, shared with runAccount() and the agent routes.
import path from "node:path";
import { z } from "zod";
import { BudgetExceededError, assertBudget } from "@/lib/cost";
import { recordingPath } from "@/lib/capture/files";
import type { Slice } from "@/lib/capture/slice";
import { perceiveScene, type PerceiveOptions, type PerceiveResult } from "@/lib/perception/perceive";
import { QUESTION_SET_MOTION_IDS, QUESTION_SETS } from "@/lib/perception/questionSets";
import { loadManifest, lockScene, NotFoundError, readJson, scenePath, writeJson } from "@/lib/store/scene";
import { probe } from "@/lib/video/ffmpeg";
import type { CameraId, Claim, RunStatus, SceneManifest } from "@/lib/types";

export const RUN_FILE = "run.json";

export interface PipelineDeps {
  loadManifest: (sceneId: string) => Promise<SceneManifest>;
  /** The scene folder, or a file inside it (the store's scenePath). */
  scenePath: (sceneId: string, file?: string) => string;
  recordingPath: (sceneId: string, camera: CameraId, files?: SceneManifest["files"]) => string | null;
  probe: (file: string) => Promise<{ durationS: number }>;
  /** Dev 1's perceiveScene(): sync -> slice -> scout -> lattice, reading manifest.json itself. */
  perceiveScene: (sceneId: string, opts: PerceiveOptions) => Promise<PerceiveResult>;
  /** slices.json, written by sliceScene during perceive. */
  loadSlices: (sceneId: string) => Promise<Slice[]>;
  /** perceiveScene's own option passed through from the caller (it reads the rest from the manifest). */
  perceiveOptions?: Pick<PerceiveOptions, "maxSlicesPerCamera">;
  writeJson: (sceneId: string, file: string, data: unknown) => Promise<void>;
  assertBudget: () => Promise<void>;
  /** Called whenever the current stage changes (logging; tests use it). */
  onStage?: (stage: string) => void;
  now: () => Date;
}

const ClaimSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string(),
  text: z.string(),
  actor: z.string(),
  object: z.string(),
  action: z.string(),
  window: z.tuple([z.number(), z.number()]),
  timeIsPrecise: z.boolean(),
}) satisfies z.ZodType<Claim>;

/** claims.json from the scene store (Dev 2's account route writes it); [] if it doesn't exist yet. */
export async function loadClaims(sceneId: string): Promise<Claim[]> {
  try {
    return await readJson(sceneId, "claims.json", z.array(ClaimSchema));
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}

/** slices.json from the store (sliceScene writes it). */
export async function loadSlices(sceneId: string): Promise<Slice[]> {
  return readJson<Slice[]>(sceneId, "slices.json");
}

/** The real stages. */
export const defaultPipelineDeps: PipelineDeps = {
  loadManifest,
  scenePath,
  recordingPath,
  probe,
  perceiveScene,
  loadSlices,
  writeJson,
  assertBudget: () => assertBudget(),
  now: () => new Date(),
};

// ---------- helpers ----------

class StageError extends Error {}

/** stills.json: camera -> the middle slice's still, as a path inside the scene folder. */
function stillIds(slices: Slice[], excluded: Set<CameraId>): Partial<Record<CameraId, string>> {
  const out: Partial<Record<CameraId, string>> = {};
  const cams = [...new Set(slices.map((s) => s.camera))].filter((c) => !excluded.has(c)).sort();
  for (const c of cams) {
    const list = slices.filter((s) => s.camera === c).sort((a, b) => a.t - b.t);
    const mid = list[Math.floor(list.length / 2)]!;
    out[c] = mid.stillPath.match(/(?:^|[\\/])(stills[\\/].+)$/)?.[1]?.replace(/\\/g, "/") ?? mid.stillPath;
  }
  return out;
}

// ---------- the run ----------

/** Runs probe -> perceive -> stills for one scene. Never throws: the final RunStatus (also in run.json) is returned. */
export async function runPipeline(sceneId: string, deps: PipelineDeps): Promise<RunStatus> {
  const d = deps;
  const startedAt = d.now().toISOString();
  let stage = "queued";
  const write = (s: RunStatus) => d.writeJson(sceneId, RUN_FILE, s);
  const enter = async (next: string) => {
    stage = next;
    d.onStage?.(next);
    await write({ status: "running", stage, startedAt });
  };

  try {
    // probe: files and durationS into manifest.json before perceiveScene() reads it.
    await enter("probe");
    const stored = await d.loadManifest(sceneId);
    const excluded = new Set<CameraId>(stored.excludedCameras);
    const included = stored.cameras.filter((c) => !excluded.has(c));
    const sceneDir = d.scenePath(sceneId);
    // On disk, files are relative to the scene folder; resolve them through scenePath before reading.
    const absolute = (files: SceneManifest["files"]): SceneManifest["files"] =>
      Object.fromEntries(Object.entries(files).map(([c, f]) => [c, path.isAbsolute(f!) ? f : d.scenePath(sceneId, f!)]));
    const relFiles: SceneManifest["files"] = {};
    const durations: number[] = [];
    for (const camera of included) {
      const file = d.recordingPath(sceneId, camera, absolute(stored.files));
      if (!file) throw new StageError(`no recording for camera ${camera}`);
      const rel = path.relative(sceneDir, file);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new StageError(`recording for camera ${camera} is outside the scene folder: ${file}`);
      }
      const { durationS } = await d.probe(file);
      relFiles[camera] = rel.split(path.sep).join("/");
      durations.push(durationS);
    }
    const updated: SceneManifest = { ...stored, files: { ...stored.files, ...relFiles }, durationS: Math.min(...durations) };
    await d.writeJson(sceneId, "manifest.json", updated); // atomic (temp file + rename)

    // perceive: Dev 1's sync -> slice -> scout -> lattice in one call, with the manifest's options.
    await enter("perceive");
    let questionSet: PerceiveOptions["questions"];
    let motionIds: string[] | undefined;
    if (updated.questionSet !== undefined) {
      if (!Object.hasOwn(QUESTION_SETS, updated.questionSet)) {
        throw new StageError(`Unknown question set "${updated.questionSet}". Known: ${Object.keys(QUESTION_SETS).join(", ")}.`);
      }
      questionSet = QUESTION_SETS[updated.questionSet];
      motionIds = Object.hasOwn(QUESTION_SET_MOTION_IDS, updated.questionSet) ? QUESTION_SET_MOTION_IDS[updated.questionSet] : undefined;
    }
    const fromManifest: Pick<PerceiveOptions, "presynced" | "questions" | "contextQuestionIds" | "roi"> = {
      ...(updated.presynced !== undefined ? { presynced: updated.presynced } : {}),
      ...(questionSet ? { questions: questionSet } : {}),
      ...(motionIds && motionIds.length ? { contextQuestionIds: motionIds } : {}),
      ...(updated.roi !== undefined ? { roi: updated.roi } : {}),
    };
    await d.assertBudget();
    let lastStep: string | undefined;
    try {
      await d.perceiveScene(sceneId, {
        ...d.perceiveOptions,
        ...fromManifest,
        onStep: (step) => {
          lastStep = step;
        },
        onRows: () => {}, // the grid is in grid.jsonl for runAccount(); nothing here labels
      });
    } catch (e) {
      // Name the Dev 1 step that failed: the one after the last reported (perceiveScene reports each when done).
      const order = ["sync", "slice", "scout", "lattice"];
      const failing = order[lastStep ? order.indexOf(lastStep) + 1 : 0] ?? "lattice";
      const msg = e instanceof Error ? e.message : String(e);
      throw new StageError(`perceive (${failing}${lastStep ? `, after ${lastStep}` : ""}): ${msg}`);
    }
    const slices = (await d.loadSlices(sceneId)).filter((s) => !excluded.has(s.camera));

    // stills.json for the agents' menu (camera -> middle still); file only, no model call.
    await enter("stills");
    await d.writeJson(sceneId, "stills.json", stillIds(slices, excluded));

    const perceived: RunStatus = { status: "perceived", stage: "perceived", startedAt, finishedAt: d.now().toISOString() };
    await write(perceived);
    return perceived;
  } catch (e) {
    const error = e instanceof BudgetExceededError ? "budget" : e instanceof Error ? e.message : String(e);
    const failed: RunStatus = { status: "failed", stage, startedAt, finishedAt: d.now().toISOString(), error };
    if (!(e instanceof StageError) && !(e instanceof BudgetExceededError)) console.error(`[pipeline] ${sceneId} ${stage}:`, e);
    try {
      await write(failed);
    } catch (w) {
      console.error(`[pipeline] ${sceneId}: could not write ${RUN_FILE}:`, w);
    }
    return failed;
  }
}

export type StartResult = { started: true; done: Promise<RunStatus> } | { started: false; reason: string };

/**
 * Starts the scene run in the background unless the scene is held (a run, the account or an agent).
 * Writes run.json { status: "queued" } first. The lock is released when the run ends.
 */
export function startPipeline(sceneId: string, deps: PipelineDeps): StartResult {
  const release = lockScene(sceneId);
  if (!release) return { started: false, reason: `Scene ${sceneId} already has a run in progress.` };
  const done = (async () => {
    try {
      await deps.writeJson(sceneId, RUN_FILE, { status: "queued", stage: "queued", startedAt: deps.now().toISOString() } satisfies RunStatus);
      return await runPipeline(sceneId, deps);
    } finally {
      release();
    }
  })();
  return { started: true, done };
}
