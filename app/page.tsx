// OWNER: Dev 4. The board (live demo screen). Ships first as a replay renderer so the UI
// never waits on the pipeline. Default: the bundled demo fixture. Override with
// ?scene=data/scenes/<id> to point at a real scene folder (identical file layout).
import { readdir, access } from "node:fs/promises";
import path from "node:path";
import { loadScene } from "@/components/loadScene";
import { Board } from "@/components/Board";

export const dynamic = "force-dynamic";

const DEFAULT_SCENE = "fixtures/replay/demo-001";

/** Saved scenes the board can replay: fixtures/replay/* and data/scenes/* that have a manifest. */
async function listScenes(): Promise<string[]> {
  const roots = ["fixtures/replay", "data/scenes"];
  const found: string[] = [];
  for (const root of roots) {
    try {
      const entries = await readdir(path.join(process.cwd(), root), { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = `${root}/${e.name}`;
        try {
          await access(path.join(process.cwd(), dir, "manifest.json"));
          found.push(dir);
        } catch {
          /* no manifest; skip */
        }
      }
    } catch {
      /* root missing; skip */
    }
  }
  return found;
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  const { scene: sceneParam } = await searchParams;
  const dir = sceneParam ?? DEFAULT_SCENE;
  const [scene, scenes] = await Promise.all([loadScene(dir), listScenes()]);
  const allScenes = scenes.includes(dir) ? scenes : [dir, ...scenes];
  return <Board scene={scene} scenes={allScenes} sceneDir={dir} />;
}
