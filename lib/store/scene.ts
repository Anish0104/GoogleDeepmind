// OWNER: Dev 3. Scene state in memory, saved to data/scenes/<sceneId>/. Any step can re-run from these files.
import type { ClaimResult, SceneManifest } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function createScene(
  _input: Pick<SceneManifest, "split" | "room" | "cameras" | "excludedCameras">,
): Promise<SceneManifest> {
  return notImplemented("Dev 3", "createScene");
}

export async function loadManifest(_sceneId: string): Promise<SceneManifest> {
  return notImplemented("Dev 3", "loadManifest");
}

export async function readJson<T>(_sceneId: string, _file: string): Promise<T> {
  return notImplemented("Dev 3", "readJson");
}

export async function writeJson(_sceneId: string, _file: string, _data: unknown): Promise<void> {
  notImplemented("Dev 3", "writeJson");
}

export async function appendJsonl(_sceneId: string, _file: string, _row: unknown): Promise<void> {
  notImplemented("Dev 3", "appendJsonl");
}

export async function saveResult(_sceneId: string, _result: ClaimResult): Promise<void> {
  notImplemented("Dev 3", "saveResult");
}
