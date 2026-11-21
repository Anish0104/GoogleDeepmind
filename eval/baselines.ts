// OWNER: Dev 2. Baselines: single camera, Carbon reading the clips (2 views, all views), Neon with all footage.
import type { Claim, Verdict } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export type BaselineName = "single-camera" | "carbon-2-clips" | "carbon-all-clips" | "neon-all-footage";

export async function runBaseline(_name: BaselineName, _sceneId: string, _claims: Claim[]): Promise<Record<string, Verdict>> {
  return notImplemented("Dev 2", "runBaseline");
}
