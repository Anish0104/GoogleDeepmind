// OWNER: Dev 4. The Capture screen (rig, sync, claim split, pipeline) over a saved scene.
import { loadScene } from "@/components/loadScene";
import { CaptureView } from "@/components/capture/CaptureView";
import { resolveSceneDir } from "@/components/scenes";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene } = await searchParams;
  const s = await loadScene(resolveSceneDir(scene));
  return <CaptureView manifest={s.manifest} claims={s.claims} />;
}
