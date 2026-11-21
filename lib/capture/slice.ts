// OWNER: Dev 1. 0.5 s slices (0.25 s where motion is detected) and stills per camera.
import type { CameraId, SceneManifest, SyncResult } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface Slice {
  camera: CameraId;
  t: number; // synced start time (s)
  durationS: number;
  path: string; // data/scenes/<id>/slices/...
}

export async function sliceScene(_manifest: SceneManifest, _sync: SyncResult[]): Promise<Slice[]> {
  return notImplemented("Dev 1", "sliceScene");
}
