// OWNER: Dev 1. SHIP FIRST: Dev 2's auditor and Dev 3's bridge call this.
// Cuts a 1-4 s clip from the local recording and asks Decision 1 about it.
import type { CameraId, Claim, Evidence } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface CheckWindowArgs {
  sceneId: string;
  camera: CameraId;
  window: [number, number];
  crop: "full" | "entity";
  claim: Claim;
  source: Evidence["source"];
}

export async function checkWindow(_args: CheckWindowArgs): Promise<Evidence> {
  return notImplemented("Dev 1", "checkWindow");
}
