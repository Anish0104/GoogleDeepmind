// OWNER: Dev 4. Which saved scenes the screens can replay. Server only (reads the disk).
import { access, readdir } from "node:fs/promises";
import path from "node:path";

/** The bundled demo fixture every screen falls back to. */
export const DEFAULT_SCENE = "fixtures/replay/demo-001";

const ROOTS = ["fixtures/replay", "data/scenes"];

/** Saved scenes: fixtures/replay/* and data/scenes/* that have a manifest. */
export async function listScenes(cwd: string = process.cwd()): Promise<string[]> {
  const found: string[] = [];
  for (const root of ROOTS) {
    try {
      const entries = await readdir(path.join(cwd, root), { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = `${root}/${e.name}`;
        try {
          await access(path.join(cwd, dir, "manifest.json"));
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

/**
 * The scene folder a ?scene= value may point at: only folders under fixtures/replay or
 * data/scenes, so the param cannot walk the disk. Anything else falls back to the demo.
 */
export function resolveSceneDir(param: string | string[] | undefined): string {
  const v = Array.isArray(param) ? param[0] : param;
  if (!v) return DEFAULT_SCENE;
  if (!v.includes("/") && !v.includes("\\") && !v.includes("..") && /^[A-Za-z0-9_-]+$/.test(v)) {
    return `data/scenes/${v}`;
  }
  const norm = path.posix.normalize(v.replace(/\\/g, "/")).replace(/\/+$/, "");
  const ok = ROOTS.some((r) => norm.startsWith(`${r}/`) && !norm.slice(r.length + 1).includes("/"));
  return ok && !norm.includes("..") ? norm : DEFAULT_SCENE;
}
