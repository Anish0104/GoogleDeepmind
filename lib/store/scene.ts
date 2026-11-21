// OWNER: Dev 3. Scene state in memory, saved to data/scenes/<sceneId>/. Any step can re-run from these files.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR } from "@/lib/config";
import { QUESTION_SETS } from "@/lib/perception/questionSets";
import type { CameraId, ClaimResult, SceneManifest } from "@/lib/types";

const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESULTS_FILE = "results.json";
const MANIFEST_FILE = "manifest.json";

const CameraIdSchema = z.enum(["A", "B", "C", "D"]);

export const SceneManifestSchema = z.object({
  sceneId: z.string().regex(SCENE_ID),
  split: z.enum(["starter", "dev", "heldout", "demo"]),
  room: z.string(),
  cameras: z.array(CameraIdSchema),
  excludedCameras: z.array(CameraIdSchema),
  files: z.partialRecord(CameraIdSchema, z.string()),
  durationS: z.number().finite().nonnegative(),
  createdAt: z.string(),
  plannedOcclusion: z.boolean(),
  presynced: z.boolean().optional(),
  questionSet: z.string().optional(),
  roi: z.boolean().optional(),
}) satisfies z.ZodType<SceneManifest>;

// ---------- paths ----------

/**
 * Absolute path to DATA_DIR/scenes/<sceneId>/ or a file inside it. Throws on an unsafe scene id
 * or a file path that would leave the scene folder (scene ids arrive from URLs).
 */
export function scenePath(sceneId: string, file?: string): string {
  if (!SCENE_ID.test(sceneId)) throw new Error(`Invalid scene id ${JSON.stringify(sceneId)}.`);
  const dir = path.resolve(DATA_DIR, "scenes", sceneId); // DATA_DIR may be relative: resolve against cwd here
  if (file === undefined) return dir;
  const full = path.resolve(dir, file);
  if (file === "" || path.isAbsolute(file) || !full.startsWith(dir + path.sep)) {
    throw new Error(`Invalid file ${JSON.stringify(file)} for scene ${sceneId}.`);
  }
  return full;
}

// ---------- per-file lock (one process; serialises read-modify-write and appends) ----------

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try {
    return await run;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

/** A scene or scene file that doesn't exist. API routes can map this to 404. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}

const isNotFound = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code === "ENOENT";

// ---------- raw JSON ----------

async function writeJsonAt(full: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tmp, full); // atomic: readers never see a half-written file
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function readJsonAt<T>(full: string, label: string, schema?: z.ZodType<T>): Promise<T> {
  let text: string;
  try {
    text = await readFile(full, "utf8");
  } catch (e) {
    if (isNotFound(e)) throw new NotFoundError(`${label} not found.`);
    throw e;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!schema) return data as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error(`${label} failed validation: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Reads DATA_DIR/scenes/<sceneId>/<file>. Pass a zod schema to validate; without one the cast is unchecked. */
export async function readJson<T>(sceneId: string, file: string, schema?: z.ZodType<T>): Promise<T> {
  return readJsonAt(scenePath(sceneId, file), `Scene ${sceneId} file ${file}`, schema);
}

/** Writes pretty JSON atomically (temp file + rename), creating folders as needed. */
export async function writeJson(sceneId: string, file: string, data: unknown): Promise<void> {
  const full = scenePath(sceneId, file);
  await withLock(full, () => writeJsonAt(full, data));
}

/** Appends one JSON row plus newline. Safe under concurrent calls in this process. */
export async function appendJsonl(sceneId: string, file: string, row: unknown): Promise<void> {
  const full = scenePath(sceneId, file);
  const line = JSON.stringify(row) + "\n";
  await withLock(full, async () => {
    await mkdir(path.dirname(full), { recursive: true });
    await appendFile(full, line, "utf8");
  });
}

// ---------- scene ----------

export interface CreateSceneOptions {
  /** Defaults to a timestamp plus random suffix, e.g. 20261121-150000-a1b2c3. */
  id?: string;
  now?: Date;
}

function newSceneId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

function checkCameras(cameras: CameraId[], excluded: CameraId[]): void {
  if (cameras.length === 0) throw new Error("A scene needs at least one camera.");
  if (new Set(cameras).size !== cameras.length) throw new Error(`Duplicate cameras: ${cameras.join(", ")}.`);
  const stray = excluded.filter((c) => !cameras.includes(c));
  if (stray.length) throw new Error(`Excluded cameras not in the scene: ${stray.join(", ")}.`);
}

/** Creates DATA_DIR/scenes/<id>/manifest.json. Refuses to overwrite an existing scene. */
export async function createScene(
  input: Pick<SceneManifest, "split" | "room" | "cameras" | "excludedCameras"> &
    Partial<Pick<SceneManifest, "plannedOcclusion" | "presynced" | "questionSet" | "roi">>,
  opts: CreateSceneOptions = {},
): Promise<SceneManifest> {
  checkCameras(input.cameras, input.excludedCameras);
  if (input.questionSet !== undefined && !Object.hasOwn(QUESTION_SETS, input.questionSet)) {
    throw new Error(`Unknown question set "${input.questionSet}". Known: ${Object.keys(QUESTION_SETS).join(", ")}.`);
  }
  const now = opts.now ?? new Date();
  const manifest = SceneManifestSchema.parse({
    sceneId: opts.id ?? newSceneId(now),
    split: input.split,
    room: input.room,
    cameras: [...input.cameras],
    excludedCameras: [...input.excludedCameras],
    files: {},
    durationS: 0,
    createdAt: now.toISOString(),
    plannedOcclusion: input.plannedOcclusion ?? false,
    ...(input.presynced !== undefined ? { presynced: input.presynced } : {}),
    ...(input.questionSet !== undefined ? { questionSet: input.questionSet } : {}),
    ...(input.roi !== undefined ? { roi: input.roi } : {}),
  });
  const full = scenePath(manifest.sceneId, MANIFEST_FILE);
  await mkdir(path.dirname(full), { recursive: true });
  try {
    await writeFile(full, JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Scene ${manifest.sceneId} already exists.`);
    throw e;
  }
  return manifest;
}

/** Reads and validates manifest.json. */
export async function loadManifest(sceneId: string): Promise<SceneManifest> {
  const full = scenePath(sceneId, MANIFEST_FILE);
  try {
    return await readJsonAt(full, `Scene ${sceneId} manifest`, SceneManifestSchema);
  } catch (e) {
    if (e instanceof NotFoundError) throw new NotFoundError(`Scene ${sceneId} not found.`);
    throw e;
  }
}

/** All saved results for a scene (results.json), or [] if none are saved yet. */
export async function loadResults(sceneId: string): Promise<ClaimResult[]> {
  try {
    const all = await readJsonAt<ClaimResult[]>(scenePath(sceneId, RESULTS_FILE), `Scene ${sceneId} ${RESULTS_FILE}`);
    if (!StoredResultsSchema.safeParse(all).success) throw new Error(`Scene ${sceneId} ${RESULTS_FILE} is not a ClaimResult[].`);
    return all;
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}

/** Shape check for an existing results.json: an array of objects with a claimId. */
const StoredResultsSchema = z.array(z.looseObject({ claimId: z.string() }));

/**
 * Saves one claim's result into results.json (ClaimResult[]): replaces the entry with the same claimId in
 * place, otherwise appends, so claim order is preserved. Serialised per scene.
 */
export async function saveResult(sceneId: string, result: ClaimResult): Promise<void> {
  const full = scenePath(sceneId, RESULTS_FILE);
  await withLock(full, async () => {
    const label = `Scene ${sceneId} ${RESULTS_FILE}`;
    let all: ClaimResult[] = [];
    try {
      all = await readJsonAt<ClaimResult[]>(full, label);
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
    // Only the shape is checked (array of { claimId }); entries were written by saveResult itself.
    if (!StoredResultsSchema.safeParse(all).success) {
      throw new Error(`${label} is not a ClaimResult[]; refusing to overwrite it.`);
    }
    const i = all.findIndex((r) => r.claimId === result.claimId);
    if (i === -1) all.push(result);
    else all[i] = result;
    await writeJsonAt(full, all);
  });
}
