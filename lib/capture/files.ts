// OWNER: Dev 1. Where each camera's recording lives: data/scenes/<id>/cam-<X>.mp4 or .webm.
import { existsSync } from "node:fs";
import path from "node:path";
import type { CameraId, SceneManifest } from "@/lib/types";
import { scenePath } from "@/lib/store/scene";

/**
 * The camera's recording, or null. A manifest `files` entry wins when it exists on disk:
 * absolute paths are used as-is, relative ones resolve inside the scene folder (manifests
 * store e.g. "cam-A.webm"). Otherwise, or if the entry is missing or unsafe, falls back to
 * the cam-<X>.mp4 / cam-<X>.webm convention.
 */
export function recordingPath(sceneId: string, camera: CameraId, files?: SceneManifest["files"]): string | null {
  const listed = files?.[camera];
  if (listed) {
    let full: string | null = null;
    try {
      full = path.isAbsolute(listed) ? listed : scenePath(sceneId, listed);
    } catch {
      full = null; // a path that leaves the scene folder is ignored
    }
    if (full && existsSync(full)) return full;
  }
  for (const ext of ["mp4", "webm"]) {
    const file = scenePath(sceneId, `cam-${camera}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}
