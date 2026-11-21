// OWNER: Dev 4. Random 3-6 action scripts (move, swap, hand over, hide, open, tip over);
// about a third include a planned occlusion. Agents never see these — scripts are ground
// truth that labelers start from. Deterministic: same seed -> same script.
// Usage: pnpm scriptgen [--count N] [--seed S] [--prefix name] [--out dir]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, ZONES } from "@/lib/config";
import type { CameraId, Zone } from "@/lib/types";

export const ACTIONS = ["move", "swap", "hand over", "hide", "open", "tip over"] as const;
export type Action = (typeof ACTIONS)[number];

/** Everyday objects an actor can manipulate in a scene. */
export const OBJECTS = [
  "mug", "keys", "book", "phone", "remote", "apple",
  "cup", "box", "pen", "bottle", "wallet", "scissors",
] as const;

export const CAMERAS: readonly CameraId[] = ["A", "B", "C", "D"];

/**
 * Which objects each action can plausibly be performed on, so every generated line
 * is physically actable (no "open the keys"). Relocation actions apply to anything;
 * open/hide/tip over are restricted to objects that can actually be opened/hidden/tipped.
 * All pools are subsets of OBJECTS.
 */
export const OBJECTS_FOR: Record<Action, readonly string[]> = {
  move: OBJECTS,
  swap: OBJECTS,
  "hand over": OBJECTS,
  open: ["box", "bottle", "book", "wallet"],
  hide: ["keys", "phone", "pen", "wallet", "apple", "remote", "scissors"],
  "tip over": ["cup", "mug", "bottle", "box"],
};

/** Actions that relocate an object get a destination zone; the rest don't. */
const MOVES_TO_ZONE = new Set<Action>(["move", "swap", "hand over"]);

const MIN_ACTIONS = 3;
const MAX_ACTIONS = 6;
const OCCLUSION_RATE = 1 / 3;

export interface SceneScript {
  sceneId: string;
  seed: number;
  actions: { action: Action; object: string; toZone?: Zone }[];
  plannedOcclusion: { camera: CameraId; atAction: number } | null;
}

/** Small deterministic PRNG so a seed fully reproduces a script. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from a sceneId, so generateScript(id) is reproducible without an explicit seed. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateScript(sceneId: string, seed: number = hashSeed(sceneId)): SceneScript {
  const rng = mulberry32(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;

  const n = MIN_ACTIONS + Math.floor(rng() * (MAX_ACTIONS - MIN_ACTIONS + 1));
  const actions: SceneScript["actions"] = [];
  for (let i = 0; i < n; i++) {
    const action = pick(ACTIONS);
    const object = pick(OBJECTS_FOR[action]);
    actions.push(MOVES_TO_ZONE.has(action) ? { action, object, toZone: pick(ZONES) } : { action, object });
  }

  const plannedOcclusion =
    rng() < OCCLUSION_RATE
      ? { camera: pick(CAMERAS), atAction: Math.floor(rng() * n) }
      : null;

  return { sceneId, seed, actions, plannedOcclusion };
}

/** Write a script to data/scripts/<sceneId>.json (gitignored; labelers read it, agents never do). */
export async function writeScript(
  script: SceneScript,
  outDir: string = path.join(DATA_DIR, "scripts"),
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${script.sceneId}.json`);
  await writeFile(file, JSON.stringify(script, null, 2) + "\n", "utf8");
  return file;
}

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const count = Number(arg(args, "--count") ?? "1");
  const prefix = arg(args, "--prefix") ?? "scene";
  const seedArg = arg(args, "--seed");
  const seedBase = seedArg !== undefined ? Number(seedArg) : undefined;
  const outDir = arg(args, "--out") ?? path.join(DATA_DIR, "scripts");

  if (!Number.isInteger(count) || count < 1) {
    console.error("--count must be a positive integer");
    process.exit(1);
  }

  for (let i = 0; i < count; i++) {
    const sceneId = `${prefix}-${String(i + 1).padStart(3, "0")}`;
    const script =
      seedBase !== undefined ? generateScript(sceneId, seedBase + i) : generateScript(sceneId);
    const file = await writeScript(script, outDir);
    const occ = script.plannedOcclusion ? `, occlusion cam ${script.plannedOcclusion.camera}` : "";
    console.log(`wrote ${file} (${script.actions.length} actions${occ})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
