// OWNER: Dev 1. 0.5 s slices and one mid-slice still per camera, on the synced timeline.
// Writes slices/cam-<X>/NNNNN.mp4, stills/cam-<X>/NNNNN.jpg and slices.json.
// Fixed 0.5 s only: Dev 2's grid code reads every GridRow as [t, t + SLICE_S).
// Excluded cameras are not sliced, so they never reach the grid.
import type { CameraId, SceneManifest, SyncResult } from "@/lib/types";
import { LIMITS } from "@/lib/config";
import { recordingPath } from "@/lib/capture/files";
import { scenePath, writeJson } from "@/lib/store/scene";
import { probe, segments, stills, type Box } from "@/lib/video/ffmpeg";
import { sceneRoi } from "@/lib/capture/roi";

export interface Slice {
  camera: CameraId;
  t: number; // synced start time (s)
  durationS: number;
  path: string; // data/scenes/<id>/slices/cam-<X>/NNNNN.mp4
  stillPath: string; // data/scenes/<id>/stills/cam-<X>/NNNNN.jpg (middle of the slice)
}

const EPS = 1e-6;
const END_MARGIN_S = 0.05; // containers often end a few ms before their stated duration
const round = (x: number) => Math.round(x * 1000) / 1000;

export interface SliceOptions {
  /** Crop each camera's slices to where things move (stills stay full-frame); writes roi.json. */
  roi?: boolean;
}

export async function sliceScene(manifest: SceneManifest, sync: SyncResult[], opts: SliceOptions = {}): Promise<Slice[]> {
  const S = LIMITS.SLICE_S;
  const cams = await Promise.all(
    manifest.cameras
      .filter((c) => !manifest.excludedCameras.includes(c))
      .map(async (camera) => {
        const file = recordingPath(manifest.sceneId, camera, manifest.files);
        const s = sync.find((r) => r.camera === camera);
        if (!file || !s) return null;
        const { durationS } = await probe(file);
        return { camera, file, offsetS: s.offsetS, durationS };
      }),
  );
  const usable = cams.filter((c) => c !== null && c.durationS > 0) as {
    camera: CameraId;
    file: string;
    offsetS: number;
    durationS: number;
  }[];
  if (usable.length === 0) throw new Error(`scene ${manifest.sceneId}: no synced recordings to slice`);

  // syncedT = localT - offsetS, so camera c covers [-offset, duration - offset].
  const start = Math.max(0, ...usable.map((c) => -c.offsetS));
  const end = Math.min(...usable.map((c) => c.durationS - c.offsetS)) - END_MARGIN_S;
  const t0 = Math.ceil(start / S - EPS) * S;
  const count = Math.floor((end - t0) / S + EPS);
  if (count < 1) throw new Error(`scene ${manifest.sceneId}: cameras share less than one slice of footage`);

  const rois: Partial<Record<CameraId, Box | null>> = {};
  if (opts.roi) {
    for (const c of usable) rois[c.camera] = await sceneRoi(c.file);
    await writeJson(manifest.sceneId, "roi.json", rois);
  }

  const perCamera = await Promise.all(
    usable.map(async (c) => {
      const local = t0 + c.offsetS;
      const [clips, frames] = await Promise.all([
        segments(c.file, local, S, count, scenePath(manifest.sceneId, `slices/cam-${c.camera}`), {
          ...(rois[c.camera] ? { crop: rois[c.camera]! } : {}),
        }),
        stills(c.file, local + S / 2, S, count, scenePath(manifest.sceneId, `stills/cam-${c.camera}`)),
      ]);
      const n = Math.min(clips.length, frames.length);
      return Array.from({ length: n }, (_, k): Slice => ({
        camera: c.camera,
        t: round(t0 + k * S),
        durationS: S,
        path: clips[k]!,
        stillPath: frames[k]!,
      }));
    }),
  );
  const slices = perCamera.flat().sort((a, b) => a.t - b.t || a.camera.localeCompare(b.camera));
  await writeJson(manifest.sceneId, "slices.json", slices);
  return slices;
}
