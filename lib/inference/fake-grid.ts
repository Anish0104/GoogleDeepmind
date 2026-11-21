// OWNER: Dev 2. Synthetic grids with known truth, for testing without model calls.
import type { CameraId, Event, GridRow, Question } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface FakeGridOptions {
  sceneId: string;
  cameras: CameraId[];
  durationS: number;
  truth: Event[];
  questions: Question[];
  noise: number; // 0-1
  sharedErrorRate: number; // errors shared between cameras
  occluded?: { camera: CameraId; window: [number, number] }[];
  seed?: number;
}

export function fakeGrid(_options: FakeGridOptions): GridRow[] {
  return notImplemented("Dev 2", "fakeGrid");
}
