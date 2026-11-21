// OWNER: Dev 1. Imports an Assembly101 recording as a RASHOMON scene: 4 of the 8 fixed (already
// synchronised) views become cameras A-D, trimmed to one stretch at 30 fps / 720p like the phone
// recordings. The stretch's action labels are exported to data/labels/<sceneId>.labels.json, outside
// the scene folder, for writing claims; nothing in the pipeline reads them.
// Assembly101 raw video is 60 fps, but every annotation frame number counts at 30 fps.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CameraId } from "@/lib/types";
import { DATA_DIR } from "@/lib/config";
import { createScene, loadManifest, scenePath, writeJson } from "@/lib/store/scene";
import { transcode } from "@/lib/video/ffmpeg";

export const ANNOTATION_FPS = 30;
const MAX_STRETCH_S = 180;

export interface LabelRow {
  startFrame: number;
  endFrame: number;
  action: string;
  verb?: string;
  noun?: string;
}

/** Coarse labels: one "start_frame<TAB>end_frame<TAB>action" row per line. */
export function parseCoarse(text: string): LabelRow[] {
  return text
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((c) => c.length >= 3 && c[0]!.trim() !== "")
    .map((c) => ({ startFrame: Number(c[0]), endFrame: Number(c[1]), action: c[2]!.trim() }));
}

/** Fine-grained CSV rows for one video ("<recording>/<view>.mp4"). */
export function parseFine(csv: string, video: string): LabelRow[] {
  const [header, ...lines] = csv.split("\n");
  const cols = (header ?? "").split(",");
  const at = (name: string) => {
    const i = cols.indexOf(name);
    if (i < 0) throw new Error(`fine-grained CSV has no ${name} column`);
    return i;
  };
  const [iv, is, ie, ia, ivb, inn] = ["video", "start_frame", "end_frame", "action_cls", "verb_cls", "noun_cls"].map(at);
  return lines
    .map((l) => l.split(","))
    .filter((c) => c[iv!] === video)
    .map((c) => ({
      startFrame: Number(c[is!]),
      endFrame: Number(c[ie!]),
      action: c[ia!]!.trim(),
      verb: c[ivb!]!.trim(),
      noun: c[inn!]!.trim(),
    }));
}

export interface SceneLabel {
  startS: number;
  endS: number;
  action: string;
  verb?: string;
  noun?: string;
  /** True when the action started before or ended after the trimmed stretch. */
  clipped: boolean;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Scene time = frame / 30 - startS; rows outside the stretch are dropped, overlapping ones clipped. */
export function toSceneSeconds(rows: LabelRow[], startS: number, endS: number): SceneLabel[] {
  const dur = endS - startS;
  return rows
    .map((r) => ({ r, a: r.startFrame / ANNOTATION_FPS - startS, b: r.endFrame / ANNOTATION_FPS - startS }))
    .filter(({ a, b }) => b > 0 && a < dur)
    .map(({ r, a, b }) => ({
      startS: r3(Math.max(0, a)),
      endS: r3(Math.min(dur, b)),
      action: r.action,
      ...(r.verb !== undefined ? { verb: r.verb } : {}),
      ...(r.noun !== undefined ? { noun: r.noun } : {}),
      clipped: a < 0 || b > dur,
    }));
}

const OptionsSchema = z
  .object({
    recordingsDir: z.string().min(1),
    annotationsDir: z.string().min(1),
    recording: z.string().regex(/^[\w.-]+$/),
    views: z.object({ A: z.string(), B: z.string(), C: z.string(), D: z.string() }),
    startS: z.number().min(0),
    endS: z.number(),
    sceneId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    height: z.number().int().min(2).default(720),
    fps: z.number().positive().default(30),
  })
  .refine((o) => o.endS - o.startS >= 1 && o.endS - o.startS <= MAX_STRETCH_S, {
    message: `stretch must be 1-${MAX_STRETCH_S} s long`,
  });

export type ImportOptions = z.input<typeof OptionsSchema>;

export interface ImportResult {
  sceneId: string;
  files: Record<CameraId, string>;
  labelsPath: string;
  coarse: number;
  fine: number;
}

export async function importAssembly101(input: ImportOptions): Promise<ImportResult> {
  const o = OptionsSchema.parse(input);
  const recDir = path.join(o.recordingsDir, o.recording);
  const cams = ["A", "B", "C", "D"] as const;
  for (const c of cams) {
    const src = path.join(recDir, `${o.views[c]}_rgb.mp4`);
    if (!existsSync(src)) throw new Error(`camera ${c}: ${o.views[c]}_rgb.mp4 not found in ${recDir}`);
  }

  if (!existsSync(scenePath(o.sceneId, "manifest.json"))) {
    await createScene({ split: "dev", room: "assembly101", cameras: [...cams], excludedCameras: [] }, { id: o.sceneId });
  }

  const files = {} as Record<CameraId, string>;
  for (const c of cams) {
    files[c] = await transcode(path.join(recDir, `${o.views[c]}_rgb.mp4`), scenePath(o.sceneId, `cam-${c}.webm`), {
      startS: o.startS,
      durationS: o.endS - o.startS,
      fps: o.fps,
      height: o.height,
    });
  }

  // createScene() writes durationS 0; the trimmed stretch's length is known, so record it.
  await writeJson(o.sceneId, "manifest.json", { ...(await loadManifest(o.sceneId)), durationS: o.endS - o.startS });

  const coarseFile = path.join(o.annotationsDir, "coarse-annotations", "coarse_labels", `assembly_${o.recording}.txt`);
  const coarse = existsSync(coarseFile) ? toSceneSeconds(parseCoarse(readFileSync(coarseFile, "utf8")), o.startS, o.endS) : [];
  const fineDir = path.join(o.annotationsDir, "fine-grained-annotations");
  const video = `${o.recording}/${o.views.A}_rgb.mp4`;
  const fineRows = existsSync(fineDir)
    ? readdirSync(fineDir)
        .filter((f) => /^(train|validation|test)\.csv$/.test(f))
        .flatMap((f) => parseFine(readFileSync(path.join(fineDir, f), "utf8"), video))
    : [];
  const fine = toSceneSeconds(fineRows, o.startS, o.endS).sort((a, b) => a.startS - b.startS);

  const labelsPath = path.resolve(DATA_DIR, "labels", `${o.sceneId}.labels.json`);
  await mkdir(path.dirname(labelsPath), { recursive: true });
  await writeFile(
    labelsPath,
    JSON.stringify(
      {
        source: "Assembly101 (CC BY-NC 4.0)",
        recording: o.recording,
        views: o.views,
        trim: { startS: o.startS, endS: o.endS },
        annotationFps: ANNOTATION_FPS,
        conversion: `sceneT = frame / ${ANNOTATION_FPS} - ${o.startS}`,
        coarse,
        fine,
      },
      null,
      2,
    ) + "\n",
  );

  return { sceneId: o.sceneId, files, labelsPath, coarse: coarse.length, fine: fine.length };
}
