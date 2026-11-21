// OWNER: Dev 4. Random 3-6 action scripts (move, swap, hand over, hide, open, tip over);
// about a third include a planned occlusion. Agents never see these. Usage: pnpm scriptgen
import { notImplemented } from "@/lib/not-implemented";

export const ACTIONS = ["move", "swap", "hand over", "hide", "open", "tip over"] as const;

export interface SceneScript {
  sceneId: string;
  actions: { action: (typeof ACTIONS)[number]; object: string; toZone?: string }[];
  plannedOcclusion: { camera: string; atAction: number } | null;
}

export function generateScript(_sceneId: string, _seed?: number): SceneScript {
  return notImplemented("Dev 4", "generateScript");
}
