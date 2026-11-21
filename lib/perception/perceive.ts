// OWNER: Dev 1. Runs Dev 1's whole pipeline for a recorded scene, in order:
// sync -> slice -> scout -> lattice. Each step writes its file in data/scenes/<id>/.
// Dev 3's /api/scene/[id]/run can call this; scripts can too.
import type { GridRow, SyncResult } from "@/lib/types";
import { syncScene } from "@/lib/capture/sync";
import { sliceScene, type Slice } from "@/lib/capture/slice";
import { scout } from "@/lib/perception/scout";
import { latticeScene } from "@/lib/perception/lattice";
import { loadManifest } from "@/lib/store/scene";

export type PerceiveStep = "sync" | "slice" | "scout" | "lattice";

export interface PerceiveOptions {
  /** Only send the first N slices per camera to the grid (keeps free-tier tests cheap). */
  maxSlicesPerCamera?: number;
  onStep?: (step: PerceiveStep, detail: string) => void;
  onRows?: (rows: GridRow[]) => void;
}

export interface PerceiveResult {
  sync: SyncResult[];
  slices: number;
  slicesUsed: number;
  entities: number;
  questions: number;
  rows: number;
}

/** One still per camera from the middle of the scene: what scout looks at. */
function scoutStills(slices: Slice[]): string[] {
  const byCamera = new Map<string, Slice[]>();
  for (const s of slices) byCamera.set(s.camera, [...(byCamera.get(s.camera) ?? []), s]);
  return [...byCamera.values()].map((list) => list[Math.floor(list.length / 2)]!.stillPath);
}

export async function perceiveScene(sceneId: string, opts: PerceiveOptions = {}): Promise<PerceiveResult> {
  const step = opts.onStep ?? (() => {});
  const manifest = await loadManifest(sceneId);

  const sync = await syncScene(manifest);
  step("sync", sync.map((s) => `${s.camera} ${s.offsetS >= 0 ? "+" : ""}${s.offsetS.toFixed(3)}s (${s.method})`).join(", "));

  const slices = await sliceScene(manifest, sync);
  step("slice", `${slices.length} slices`);

  const { entities, questions } = await scout(scoutStills(slices), sceneId);
  step("scout", `${entities.length} objects: ${entities.map((e) => e.id).join(", ")}; ${questions.length} questions`);

  const max = opts.maxSlicesPerCamera;
  const counts = new Map<string, number>();
  const used =
    max === undefined
      ? slices
      : slices.filter((s) => {
          const n = counts.get(s.camera) ?? 0;
          counts.set(s.camera, n + 1);
          return n < max;
        });
  const rows = await latticeScene(used, questions, sceneId, opts.onRows);
  step("lattice", `${rows.length} grid rows from ${used.length} slices`);

  return {
    sync,
    slices: slices.length,
    slicesUsed: used.length,
    entities: entities.length,
    questions: questions.length,
    rows: rows.length,
  };
}
