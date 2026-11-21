// OWNER: Dev 1. Imports one NVIDIA SDG-Warehouse forklift-human near-miss run (Isaac Sim, OpenMDW-1.1)
// as a RASHOMON scene. The run's cameras share one clock, so the scene is presynced: run
// perceiveScene({ presynced: true, questions: SDG_NEARMISS_QUESTIONS, contextQuestionIds:
// SDG_NEARMISS_MOTION_QUESTION_IDS }). 4 of the run's 5-10 cameras become A-D, re-encoded like the
// phone recordings (silent webm, 30 fps, 720p).
// The answer key (lib/capture/sdgTruth.ts plus per-camera visibility from the instance masks) goes to
// data/labels/<sceneId>.truth.json, outside the scene folder: it is for scoring only and nothing in the
// pipeline or any agent reads it.
// Input is an extracted artifacts shard (meta.json + per-camera rgb.mp4, object_detection.jsonl,
// instance_id_segmentation.npz and its _mapping.jsonl). Example:
//   pnpm tsx -e 'import("@/lib/capture/sdgWarehouse").then(m => m.importSdgWarehouse({
//     runDir: "data/external/sdg-warehouse/extracted", runId: "<run id>", sceneId: "sdg_run25" }))'
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CameraId } from "@/lib/types";
import { DATA_DIR } from "@/lib/config";
import { createScene, loadManifest, scenePath, writeJson } from "@/lib/store/scene";
import { transcode } from "@/lib/video/ffmpeg";
import { maskCounts } from "@/lib/capture/sdgMasks";
import {
  SDG,
  checkRun,
  parseDetections,
  sliceTruth,
  summarizeRun,
  trackRun,
  visibilityAnswer,
  type Answer,
} from "@/lib/capture/sdgTruth";

const CAMS: CameraId[] = ["A", "B", "C", "D"];
const ENTITIES = { worker: "/World/Characters/", forklift: "/World/Robots/" };
/** Cameras whose masks are read at once (each streams ~2.5 GB through unzip). */
const MASK_CONCURRENCY = 3;
/** Seconds either side of the closest approach that count as the key moment when picking views. */
const KEY_WINDOW_S = 1;

const MetaSchema = z.object({
  run_id: z.string(),
  scenario: z.string(),
  cameras: z
    .array(
      z.object({
        camera_alias: z.string().regex(/^[\w-]+$/),
        members: z.record(z.string(), z.string()),
      }),
    )
    .min(1),
});

const AnswerSchema = z.enum(["yes", "no", "unclear"]);

/** The answer key file as importSdgWarehouse() writes it (only the fields readers rely on are checked). */
export const SdgTruthFileSchema = z.looseObject({
  sceneId: z.string(),
  runId: z.string(),
  views: z.object({ A: z.string(), B: z.string(), C: z.string(), D: z.string() }),
  summary: z.looseObject({ outcome: z.enum(["contact", "near_miss", "unclear"]) }),
  slices: z.array(
    z.looseObject({
      t: z.number(),
      answers: z.record(z.string(), AnswerSchema),
      cameras: z.record(z.string(), z.object({ alias: z.string() }).catchall(z.union([AnswerSchema, z.number(), z.string()]))),
    }),
  ),
});
export type SdgTruthFile = z.infer<typeof SdgTruthFileSchema>;

export function readSdgTruth(file: string): SdgTruthFile {
  return SdgTruthFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Middle frame of each 0.5 s slice. */
export function sliceMidFrames(frames: number, fps: number = SDG.FPS): number[] {
  const per = SDG.SLICE_S * fps;
  const n = Math.floor(frames / per + 1e-9);
  return Array.from({ length: n }, (_, k) => Math.floor(k * per + per / 2 - 0.5));
}

export interface CameraVisibility {
  alias: string;
  /** Per slice. */
  worker: Answer[];
  forklift: Answer[];
}

export interface ViewChoice {
  views: Record<CameraId, string>;
  reasons: Record<CameraId, string>;
}

/**
 * A = the ceiling camera that sees both worker and forklift in the most slices, B = the best eye-level one,
 * C = the next best, D = the camera that most often loses the worker behind something while still seeing
 * the forklift around the closest approach (the "Insufficient footage" camera), else the fourth best.
 */
export function chooseViews(cams: CameraVisibility[], keySlices: number[]): ViewChoice {
  if (cams.length < 4) throw new Error(`need at least 4 cameras, run has ${cams.length}`);
  const seen = (c: CameraVisibility) => c.worker.filter((w, i) => w === "yes" && c.forklift[i] === "yes").length;
  const blocked = (c: CameraVisibility) => keySlices.filter((i) => c.worker[i] === "no" && c.forklift[i] === "yes").length;
  const byCover = [...cams].sort((a, b) => seen(b) - seen(a));
  const reasons = {} as Record<CameraId, string>;
  const taken = new Set<string>();
  const take = (slot: CameraId, c: CameraVisibility, why: string) => {
    taken.add(c.alias);
    reasons[slot] = `${c.alias}: ${why}`;
    return c.alias;
  };

  const mostBlocked = [...cams].sort((a, b) => blocked(b) - blocked(a))[0]!;
  const d = blocked(mostBlocked) > 0 ? mostBlocked : null;
  if (d) taken.add(d.alias);
  const free = () => byCover.filter((c) => !taken.has(c.alias));
  const best = (prefix: string) => free().find((c) => c.alias.startsWith(prefix)) ?? free()[0]!;

  const a = best("ceiling");
  const A = take("A", a, `sees worker and forklift in ${seen(a)}/${a.worker.length} slices`);
  const b = best("eye");
  const B = take("B", b, `sees worker and forklift in ${seen(b)}/${b.worker.length} slices`);
  const c = free()[0]!;
  const C = take("C", c, `sees worker and forklift in ${seen(c)}/${c.worker.length} slices`);
  const D = d
    ? take("D", d, `worker hidden while the forklift is visible in ${blocked(d)} of ${keySlices.length} slices around the closest approach`)
    : take("D", free()[0]!, `fourth-best coverage (${seen(free()[0]!)}/${free()[0]!.worker.length} slices); no camera loses the worker`);
  return { views: { A, B, C, D }, reasons };
}

const OptionsSchema = z.object({
  runDir: z.string().min(1),
  runId: z.string().regex(/^[\w.-]+$/),
  sceneId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
  views: z.object({ A: z.string(), B: z.string(), C: z.string(), D: z.string() }).optional(),
  height: z.number().int().min(2).default(720),
  fps: z.number().positive().default(30),
});
export type SdgImportOptions = z.input<typeof OptionsSchema>;

export interface SdgImportResult {
  sceneId: string;
  views: Record<CameraId, string>;
  files: Record<CameraId, string>;
  truthPath: string;
  outcome: "contact" | "near_miss" | "unclear";
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function importSdgWarehouse(input: SdgImportOptions): Promise<SdgImportResult> {
  const o = OptionsSchema.parse(input);
  const metaPath = path.join(o.runDir, `${o.runId}.meta.json`);
  if (!existsSync(metaPath)) throw new Error(`no ${o.runId}.meta.json in ${o.runDir}`);
  const meta = MetaSchema.parse(JSON.parse(readFileSync(metaPath, "utf8")));
  if (meta.scenario !== "nearmiss") throw new Error(`run ${o.runId} is scenario "${meta.scenario}", expected "nearmiss"`);
  const member = (alias: string, kind: string) => {
    const cam = meta.cameras.find((c) => c.camera_alias === alias);
    if (!cam) throw new Error(`run ${o.runId} has no camera ${alias} (has ${meta.cameras.map((c) => c.camera_alias).join(", ")})`);
    const f = cam.members[kind];
    if (!f || !/^[\w.-]+$/.test(f)) throw new Error(`camera ${alias}: no ${kind} file listed`);
    const p = path.join(o.runDir, f);
    if (!existsSync(p)) throw new Error(`camera ${alias}: ${f} not found in ${o.runDir}`);
    return p;
  };
  if (o.views) for (const c of CAMS) member(o.views[c], "rgb");

  // Boxes are in world space, so the first camera's file gives the whole run.
  const first = meta.cameras[0]!.camera_alias;
  const track = trackRun(parseDetections(readFileSync(member(first, "object_detection"), "utf8")));
  const unusable = checkRun(track);
  if (unusable) throw new Error(`run ${o.runId} is not a usable near-miss scene: ${unusable}`);
  const summary = summarizeRun(track);
  const slices = sliceTruth(track);
  const mids = sliceMidFrames(track.length).slice(0, slices.length);

  const vis = await inBatches(meta.cameras, MASK_CONCURRENCY, async (c) => {
    const alias = c.camera_alias;
    const m = await maskCounts(member(alias, "instance_id_segmentation"), member(alias, "instance_id_segmentation_mapping"), mids, ENTITIES);
    const px = m.width * m.height;
    const counts = mids.map((f) => m.counts.get(f)!);
    return {
      alias,
      workerPx: counts.map((x) => x.worker!),
      forkliftPx: counts.map((x) => x.forklift!),
      worker: counts.map((x) => visibilityAnswer(x.worker!, px)),
      forklift: counts.map((x) => visibilityAnswer(x.forklift!, px)),
    };
  });

  const keySlices = slices
    .map((s, i) => [s, i] as const)
    .filter(([s]) => s.t + SDG.SLICE_S > summary.minGapT - KEY_WINDOW_S && s.t < summary.minGapT + KEY_WINDOW_S)
    .map(([, i]) => i);
  const choice = o.views
    ? { views: o.views as Record<CameraId, string>, reasons: Object.fromEntries(CAMS.map((c) => [c, `${o.views![c]}: chosen by caller`])) }
    : chooseViews(vis, keySlices);

  if (!existsSync(scenePath(o.sceneId, "manifest.json"))) {
    await createScene({ split: "dev", room: "sdg-warehouse", cameras: [...CAMS], excludedCameras: [] }, { id: o.sceneId });
  }
  const files = {} as Record<CameraId, string>;
  for (const c of CAMS) {
    files[c] = await transcode(member(choice.views[c], "rgb"), scenePath(o.sceneId, `cam-${c}.webm`), {
      startS: 0,
      durationS: summary.durationS,
      fps: o.fps,
      height: o.height,
    });
  }

  // createScene() writes durationS 0; the run's length is known, so record it.
  await writeJson(o.sceneId, "manifest.json", { ...(await loadManifest(o.sceneId)), durationS: summary.durationS });

  const byAlias = new Map(vis.map((v) => [v.alias, v]));
  const truthPath = path.resolve(DATA_DIR, "labels", `${o.sceneId}.truth.json`);
  await mkdir(path.dirname(truthPath), { recursive: true });
  await writeFile(
    truthPath,
    JSON.stringify(
      {
        source: "NVIDIA PhysicalAI SDG-Warehouse, forklift_human_nearmiss (OpenMDW-1.1)",
        runId: o.runId,
        sceneId: o.sceneId,
        presynced: true,
        views: choice.views,
        viewReasons: choice.reasons,
        thresholds: SDG,
        summary,
        slices: slices.map((s, i) => ({
          ...s,
          frame: mids[i],
          cameras: Object.fromEntries(
            CAMS.map((c) => {
              const v = byAlias.get(choice.views[c])!;
              return [c, {
                alias: v.alias,
                workerPx: v.workerPx[i],
                forkliftPx: v.forkliftPx[i],
                "worker:visible:yes": v.worker[i],
                "forklift:visible:yes": v.forklift[i],
              }];
            }),
          ),
        })),
        allCameras: vis.map((v) => ({ alias: v.alias, worker: v.worker, forklift: v.forklift })),
      },
      null,
      2,
    ) + "\n",
  );

  return { sceneId: o.sceneId, views: choice.views, files, truthPath, outcome: summary.outcome };
}
