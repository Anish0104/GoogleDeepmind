// OWNER: Dev 4. /proof opens the most telling claim: the first Contradicted one, else the first.
import { redirect } from "next/navigation";
import { loadScene } from "@/components/loadScene";
import { DEFAULT_SCENE, resolveSceneDir } from "@/components/scenes";
import { defaultProofClaim } from "@/components/proof/defaultClaim";

export const dynamic = "force-dynamic";

export default async function ProofIndex({ searchParams }: { searchParams: Promise<{ scene?: string }> }) {
  const { scene } = await searchParams;
  const dir = resolveSceneDir(scene);
  const s = await loadScene(dir);
  const id = defaultProofClaim(s.claims, s.results);
  const q = dir === DEFAULT_SCENE ? "" : `?scene=${encodeURIComponent(dir)}`;
  redirect(id ? `/proof/${encodeURIComponent(id)}${q}` : `/board${q}`);
}
