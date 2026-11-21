// OWNER: Dev 4. Proof for one claim: /proof/<claimId>?clip=<n>&scene=<dir>.
import { loadScene } from "@/components/loadScene";
import { ProofView } from "@/components/proof/ProofView";
import { DEFAULT_SCENE, resolveSceneDir } from "@/components/scenes";

export const dynamic = "force-dynamic";

export default async function ProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ claimId: string }>;
  searchParams: Promise<{ scene?: string; clip?: string }>;
}) {
  const [{ claimId }, { scene, clip }] = await Promise.all([params, searchParams]);
  const dir = resolveSceneDir(scene);
  const s = await loadScene(dir);
  const clipIdx = Math.max(0, Number.parseInt(clip ?? "0", 10) || 0);
  const sceneQuery = dir === DEFAULT_SCENE ? "" : `?scene=${encodeURIComponent(dir)}`;
  return (
    <ProofView
      key={`${claimId}:${clipIdx}`}
      sceneId={s.manifest.sceneId}
      claims={s.claims}
      results={s.results}
      claimId={decodeURIComponent(claimId)}
      initialClip={clipIdx}
      sceneQuery={sceneQuery}
    />
  );
}
