// OWNER: Dev 4. The landing page (Overview). The board moved to /board.
// ?hero=Braid or ?hero=Field picks another hero canvas (default Convergence).
import { loadScene } from "@/components/loadScene";
import { Overview } from "@/components/overview/Overview";
import { DEFAULT_SCENE } from "@/components/scenes";
import type { HeroVariant } from "@/components/canvas/drawHero";

export const dynamic = "force-dynamic";

const VARIANTS: HeroVariant[] = ["Convergence", "Braid", "Field"];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ hero?: string }> }) {
  const { hero } = await searchParams;
  const variant = VARIANTS.find((v) => v.toLowerCase() === hero?.toLowerCase()) ?? "Convergence";
  const scene = await loadScene(DEFAULT_SCENE);
  return <Overview variant={variant} sceneId={scene.manifest.sceneId} claims={scene.claims} results={scene.results} />;
}
