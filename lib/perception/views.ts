// OWNER: Dev 1. Hydrogen: one sentence per camera describing its angle and what's blocked.
import type { CameraId, ViewDescription } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export async function describeViews(
  _stillsByCamera: Partial<Record<CameraId, string>>,
  _sceneId: string,
): Promise<ViewDescription[]> {
  return notImplemented("Dev 1", "describeViews");
}
