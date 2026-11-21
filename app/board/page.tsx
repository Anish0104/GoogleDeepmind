// OWNER: Dev 4. The board (live demo screen). Ships as a replay renderer so the UI never
// waits on the pipeline. Default: the bundled demo fixture. Override with
// ?scene=data/scenes/<id> to point at a real scene folder (identical file layout).
import { loadScene } from "@/components/loadScene";
import { Board } from "@/components/Board";
import { DEFAULT_SCENE, listScenes, resolveSceneDir } from "@/components/scenes";

export const dynamic = "force-dynamic";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene: sceneParam } = await searchParams;
  const dir = resolveSceneDir(sceneParam);
  const [scene, scenes] = await Promise.all([loadScene(dir), listScenes()]);
  const allScenes = scenes.includes(dir) ? scenes : [dir, ...scenes];
  return <Board scene={scene} scenes={allScenes} sceneDir={dir} defaultDir={DEFAULT_SCENE} />;
}
