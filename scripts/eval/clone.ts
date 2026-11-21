// OWNER: Dev 3. Clones a perceived scene for one eval account: <sceneId> -> <sceneId>__<account>.
// Perception outputs are copied (JSON/JSONL), with sceneId rewritten in manifest.json and in every grid.jsonl row
// (Dev 2's evidence code filters grid rows by sceneId). Media (recordings, slices/, stills/) are symlinked, so
// nothing is re-perceived and no video is duplicated. Outputs of earlier runs are not copied.
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";

const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Outputs of earlier account/agent/pipeline runs, and clips cut for an earlier run. */
export const NOT_CLONED = new Set(["results.json", "claims.json", "agent-steps.jsonl", "run.json", "clips"]);

const sceneDir = (dataDir: string, sceneId: string) => {
  if (!SCENE_ID.test(sceneId)) throw new Error(`Invalid scene id ${JSON.stringify(sceneId)}.`);
  return path.resolve(dataDir, "scenes", sceneId);
};

export async function cloneScene(sceneId: string, cloneId: string, dataDir: string = DATA_DIR): Promise<void> {
  const src = sceneDir(dataDir, sceneId);
  const dst = sceneDir(dataDir, cloneId);
  try {
    await stat(path.join(src, "manifest.json"));
  } catch {
    throw new Error(`Scene ${sceneId} not found under ${path.dirname(src)}.`);
  }
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });

  for (const entry of await readdir(src, { withFileTypes: true })) {
    const name = entry.name;
    if (NOT_CLONED.has(name) || name.endsWith(".tmp")) continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (name === "manifest.json") {
      const m = JSON.parse(await readFile(from, "utf8")) as Record<string, unknown>;
      await writeFile(to, JSON.stringify({ ...m, sceneId: cloneId }, null, 2) + "\n");
    } else if (name === "grid.jsonl") {
      const out = (await readFile(from, "utf8"))
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => {
          try {
            return JSON.stringify({ ...(JSON.parse(l) as Record<string, unknown>), sceneId: cloneId });
          } catch {
            return null; // a half-written line; Dev 2's reader would skip it anyway
          }
        })
        .filter((l): l is string => l !== null);
      await writeFile(to, out.length ? out.join("\n") + "\n" : "");
    } else if (entry.isFile() && /\.(json|jsonl)$/.test(name)) {
      await cp(from, to);
    } else {
      await symlink(from, to); // recordings, slices/, stills/: shared read-only with the source scene
    }
  }
}
