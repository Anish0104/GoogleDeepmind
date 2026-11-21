// OWNER: Dev 1. Where each camera's recording lives: data/scenes/<id>/cam-<X>.mp4 or .webm.
import { existsSync } from "node:fs";
import path from "node:path";
import type { CameraId, SceneManifest } from "@/lib/types";
import { scenePath } from "@/lib/store/scene";

/** The camera's recording, or null. A manifest `files` entry wins when it exists on disk. */
export function recordingPath(sceneId: string, camera: CameraId, files?: SceneManifest["files"]): string | null {
  const listed = files?.[camera];
  if (listed) {
    const full = path.resolve(listed);
    return existsSync(full) ? full : null;
  }
  for (const ext of ["mp4", "webm"]) {
    const file = scenePath(sceneId, `cam-${camera}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}
