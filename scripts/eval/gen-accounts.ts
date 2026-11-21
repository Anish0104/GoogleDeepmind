// OWNER: Dev 3. Writes the eval accounts for warehouse scenes: data/eval/cases/<sceneId>.json.
// Usage: pnpm tsx scripts/eval/gen-accounts.ts <sceneId…>
// Reads the answer key (data/labels/<sceneId>.truth.json) and the scene's manifest (for excluded cameras).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "@/lib/config";
import { SceneManifestSchema } from "@/lib/store/scene";
import type { SceneManifest } from "@/lib/types";
import { buildCase, SEED } from "@/scripts/eval/accounts";
import { readTruth } from "@/scripts/eval/truth";

export interface GenOptions {
  dataDir?: string;
  seed?: number;
}

export const casePath = (sceneId: string, dataDir: string = DATA_DIR) => path.resolve(dataDir, "eval", "cases", `${sceneId}.json`);

async function readManifest(sceneId: string, dataDir: string): Promise<SceneManifest> {
  const file = path.resolve(dataDir, "scenes", sceneId, "manifest.json");
  return SceneManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Builds and writes each scene's case file. Returns the files written. */
export async function genAccounts(sceneIds: string[], opts: GenOptions = {}): Promise<string[]> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const files: string[] = [];
  for (const sceneId of sceneIds) {
    const [truth, manifest] = await Promise.all([readTruth(sceneId, dataDir), readManifest(sceneId, dataDir)]);
    const c = buildCase(truth, manifest, opts.seed ?? SEED);
    const file = casePath(sceneId, dataDir);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(c, null, 2) + "\n");
    files.push(file);
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: pnpm tsx scripts/eval/gen-accounts.ts <sceneId…>");
    process.exit(1);
  }
  for (const f of await genAccounts(ids)) console.log(`wrote ${path.relative(process.cwd(), f)}`);
}
