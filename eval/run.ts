// OWNER: Dev 4. Runs the evaluation over a split and reports it. The per-scene scoring
// pipeline (perception -> inference -> truth -> agents) is owned by Devs 1-3; this file
// resolves the split, tracks which scenes are scored, and hands the scored set to the
// report. Wire the live pipeline in at scoreScene(). The held-out split is run exactly once.
// Usage: pnpm eval:run --split dev   (or --split heldout)
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "@/lib/config";
import type { SceneManifest } from "@/lib/types";
import { buildReport } from "./report";

export type Split = SceneManifest["split"];

export interface SplitScene {
  sceneId: string;
  dir: string;
  scored: boolean; // has results.json
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The scenes in a split, each flagged with whether it already has results.json. */
export async function resolveSplit(split: Split, dataDir: string = DATA_DIR): Promise<SplitScene[]> {
  const scenesDir = path.join(dataDir, "scenes");
  let ids: string[] = [];
  try {
    const entries = await readdir(scenesDir, { withFileTypes: true });
    ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const out: SplitScene[] = [];
  for (const sceneId of ids) {
    const dir = path.join(scenesDir, sceneId);
    let manifest: SceneManifest | null = null;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as SceneManifest;
    } catch {
      continue;
    }
    if (manifest.split !== split) continue;
    out.push({ sceneId, dir, scored: await exists(path.join(dir, "results.json")) });
  }
  return out.sort((a, b) => a.sceneId.localeCompare(b.sceneId));
}

/**
 * Score one scene: run the pipeline and write results.json. Devs 1-3 own the stages,
 * so this is the single wiring point. Until it's connected, scenes must be scored
 * another way (a replay drop, or the per-claim /api routes) before eval reports them.
 */
async function scoreScene(_scene: SplitScene): Promise<boolean> {
  // TODO(cross-team): call perception -> inference -> truth -> agents here and write results.json.
  return false;
}

export async function runSplit(split: Split, dataDir: string = DATA_DIR): Promise<void> {
  if (split === "heldout") {
    console.log("Held-out split: this is the final run and should happen exactly once.\n");
  }

  const scenes = await resolveSplit(split, dataDir);
  if (scenes.length === 0) {
    console.log(`No scenes in split "${split}" under ${path.join(dataDir, "scenes")}.`);
    return;
  }

  let scored = 0;
  let pending = 0;
  for (const scene of scenes) {
    if (scene.scored) {
      scored++;
      continue;
    }
    const didScore = await scoreScene(scene);
    if (didScore) {
      scored++;
    } else {
      pending++;
      console.log(`[pending] ${scene.sceneId} — no results.json (pipeline not wired yet)`);
    }
  }

  console.log(`\nSplit "${split}": ${scenes.length} scene(s), ${scored} scored, ${pending} pending.\n`);
  await buildReport(dataDir);
}

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const split = (arg(process.argv.slice(2), "--split") ?? "dev") as Split;
  runSplit(split).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
