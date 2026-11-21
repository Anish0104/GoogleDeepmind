// OWNER: Dev 1. Cross-camera object matching (Decision 1 "choice" questions, checked by zone).
import type { CameraId, Entity } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

/** Returns, per camera, a map from a local crop id to an entity id (or null if unmatched). */
export async function matchEntities(
  _cropsByCamera: Partial<Record<CameraId, string[]>>,
  _entities: Entity[],
): Promise<Partial<Record<CameraId, Record<string, string | null>>>> {
  return notImplemented("Dev 1", "matchEntities");
}
