// OWNER: Dev 1. Runs Dev 1's whole pipeline for a recorded scene, in order:
// sync -> slice -> scout -> lattice. Each step writes its file in data/scenes/<id>/.
// Dev 3's /api/scene/[id]/run can call this; scripts can too.
import type { CameraId, GridRow, Question, SyncResult } from "@/lib/types";
import { syncScene } from "@/lib/capture/sync";
import { sliceScene, type Slice } from "@/lib/capture/slice";
import { scout } from "@/lib/perception/scout";
import { describeViews } from "@/lib/perception/views";
import { latticeScene } from "@/lib/perception/lattice";
import { loadManifest, writeJson } from "@/lib/store/scene";
import { questionSet as loadQuestionSet } from "@/lib/perception/questionSets";
import { GRID_CALIBRATION } from "@/lib/perception/gridCalibration";

export type PerceiveStep = "sync" | "slice" | "views" | "scout" | "lattice";

export interface PerceiveOptions {
  /** Only send the first N slices per camera to the grid (keeps free-tier tests cheap). */
  maxSlicesPerCamera?: number;
  /**
   * Per-question Platt curves for the grid. Defaults to GRID_CALIBRATION for the question set; false
   * turns calibration off. When on, raw answers are also kept in grid.raw.jsonl.
   */
  calibration?: Record<string, { a: number; b: number }> | false;
  /** Score only every Nth slice per camera (context clips still use every slice). Default 1. */
  sliceStride?: number;
  /**
   * A named question set (see QUESTION_SETS, e.g. "sdg-nearmiss"). Replaces scout entirely: the set's
   * entities, people and questions are written to entities.json, people.json and questions.json, so their
   * ids match, and its motion questions go on 2 s clips. Defaults to the manifest's `questionSet` field.
   */
  questionSet?: string;
  /** Fixed questions without a registry; scout still writes entities.json (prefer questionSet). */
  questions?: Question[];
  /**
   * Footage that is already synchronised (e.g. Assembly101's fixed views): skip clap/flash sync and use
   * zero offsets. Without sync.json, localTime() treats synced and local time as equal.
   * Defaults to the manifest's `presynced` field when present.
   */
  presynced?: boolean;
  /** Crop slices to where things move in each camera (see lib/capture/roi.ts). */
  roi?: boolean;
  /** Question ids asked over a ~2 s clip instead of one slice (motion questions). */
  contextQuestionIds?: string[];
  onStep?: (step: PerceiveStep, detail: string) => void;
  onRows?: (rows: GridRow[]) => void;
}

export interface PerceiveResult {
  presynced: boolean;
  sync: SyncResult[];
  slices: number;
  slicesUsed: number;
  /** Cameras described in views.json (0 if that call failed; perception still completes). */
  views?: number;
  entities: number;
  questions: number;
  rows: number;
}

/** One still per camera from the middle of the scene: what scout looks at. */
function scoutStills(slices: Slice[]): string[] {
  const byCamera = new Map<string, Slice[]>();
  for (const s of slices) byCamera.set(s.camera, [...(byCamera.get(s.camera) ?? []), s]);
  return [...byCamera.values()].map((list) => list[Math.floor(list.length / 2)]!.stillPath);
}

export async function perceiveScene(sceneId: string, opts: PerceiveOptions = {}): Promise<PerceiveResult> {
  const step = opts.onStep ?? (() => {});
  const manifest = await loadManifest(sceneId);

  const presynced = opts.presynced ?? (manifest as { presynced?: boolean }).presynced ?? false;
  // SyncResult.method has no "presynced" value, so these in-memory results say "both"; nothing is written.
  const sync: SyncResult[] = presynced
    ? manifest.cameras.map((camera) => ({ camera, offsetS: 0, driftPerMin: 0, method: "both" as const }))
    : await syncScene(manifest);
  if (presynced) step("sync", `presynced: zero offsets for ${manifest.cameras.join(", ")} (sync.json not written)`);
  else step("sync", sync.map((s) => `${s.camera} ${s.offsetS >= 0 ? "+" : ""}${s.offsetS.toFixed(3)}s (${s.method})`).join(", "));

  const slices = await sliceScene(manifest, sync, { roi: opts.roi ?? false });
  step("slice", `${slices.length} slices`);

  // views.json for the agents' menu: optional, so a failure is reported, not fatal.
  let views = 0;
  try {
    const mid: Partial<Record<CameraId, string>> = {};
    for (const c of manifest.cameras) {
      const list = slices.filter((s) => s.camera === c);
      if (list.length) mid[c] = list[Math.floor(list.length / 2)]!.stillPath;
    }
    views = (await describeViews(mid, sceneId)).length;
    step("views", `${views} cameras described`);
  } catch (e) {
    step("views", `failed: ${e instanceof Error ? e.message : String(e)} (views.json not written)`);
  }

  const setName = opts.questionSet ?? (manifest as { questionSet?: string }).questionSet;
  let entities: { id: string }[];
  let questions: Question[];
  let contextQuestionIds = opts.contextQuestionIds;
  let contextSlices: number | undefined;
  if (setName !== undefined) {
    // A fixed registry: no scout call, and entity ids are the ones the questions use.
    const set = loadQuestionSet(setName);
    entities = set.entities;
    questions = opts.questions ?? set.questions;
    contextQuestionIds ??= set.motionIds;
    contextSlices = set.contextSlices;
    await writeJson(sceneId, "entities.json", set.entities);
    await writeJson(sceneId, "people.json", set.people);
    await writeJson(sceneId, "questions.json", questions);
    step("scout", `question set ${setName}: ${entities.map((e) => e.id).join(", ")}; ${questions.length} questions (no scout call)`);
  } else {
    const scouted = await scout(scoutStills(slices), sceneId);
    entities = scouted.entities;
    questions = opts.questions ?? scouted.questions;
    if (opts.questions) await writeJson(sceneId, "questions.json", questions);
    step("scout", `${entities.length} objects: ${entities.map((e) => e.id).join(", ")}; ${questions.length} questions`);
  }

  const max = opts.maxSlicesPerCamera ?? Infinity;
  const stride = Math.max(1, Math.floor(opts.sliceStride ?? 1));
  const counts = new Map<string, number>();
  const used = [...slices]
    .sort((a, b) => a.t - b.t)
    .filter((s) => {
      const n = counts.get(s.camera) ?? 0; // index of this slice within its camera
      counts.set(s.camera, n + 1);
      return n % stride === 0 && n / stride < max;
    });
  const calibration = opts.calibration === false ? undefined : (opts.calibration ?? (setName ? GRID_CALIBRATION[setName] : undefined));
  const rows = await latticeScene(used, questions, sceneId, opts.onRows, {
    contextFrom: slices,
    ...(calibration && Object.keys(calibration).length ? { calibration } : {}),
    ...(contextQuestionIds && contextQuestionIds.length ? { contextQuestionIds } : {}),
    ...(contextSlices !== undefined ? { contextSlices } : {}),
  });
  step("lattice", `${rows.length} grid rows from ${used.length} slices`);

  return {
    presynced,
    sync,
    slices: slices.length,
    slicesUsed: used.length,
    views,
    entities: entities.length,
    questions: questions.length,
    rows: rows.length,
  };
}
