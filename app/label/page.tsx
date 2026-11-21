// OWNER: Dev 4. Labeling tool for ground truth. Labelers see the spoken claims and may
// start from the scene script, but NEVER see system output (results.json). Reads claims
// only. Pick a scene with ?scene=<id>.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { DATA_DIR } from "@/lib/config";
import type { Claim } from "@/lib/types";
import { LabelForm, type LabelClaim } from "./LabelForm";

export const dynamic = "force-dynamic";

const SCENES_DIR = path.join(DATA_DIR, "scenes");

async function listLabelableScenes(): Promise<string[]> {
  try {
    const entries = await readdir(SCENES_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    const withClaims: string[] = [];
    for (const id of dirs) {
      try {
        await readFile(path.join(SCENES_DIR, id, "claims.json"), "utf8");
        withClaims.push(id);
      } catch {
        /* no claims yet */
      }
    }
    return withClaims;
  } catch {
    return [];
  }
}

async function loadClaims(sceneId: string): Promise<LabelClaim[]> {
  try {
    const raw = await readFile(path.join(SCENES_DIR, path.basename(sceneId), "claims.json"), "utf8");
    return (JSON.parse(raw) as Claim[]).map((c) => ({ id: c.id, text: c.text, window: c.window }));
  } catch {
    return [];
  }
}

export default async function LabelPage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  const { scene } = await searchParams;
  const scenes = await listLabelableScenes();
  const claims = scene ? await loadClaims(scene) : [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="border-b border-neutral-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Labeling</h1>
        <p className="text-xs text-neutral-500">
          Mark each claim from the footage. You never see the system&rsquo;s own answers.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {scenes.length === 0 && (
          <span className="text-sm text-neutral-400">No scenes with claims found under {SCENES_DIR}.</span>
        )}
        {scenes.map((id) => (
          <Link
            key={id}
            href={`/label?scene=${encodeURIComponent(id)}`}
            className={[
              "rounded border px-2.5 py-1 font-mono text-xs",
              id === scene
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
            ].join(" ")}
          >
            {id}
          </Link>
        ))}
      </div>

      <div className="mt-6">
        {!scene ? (
          <p className="text-sm text-neutral-500">Pick a scene to start labeling.</p>
        ) : claims.length === 0 ? (
          <p className="text-sm text-neutral-500">No claims found for {scene}.</p>
        ) : (
          <LabelForm sceneId={scene} claims={claims} />
        )}
      </div>
    </main>
  );
}
