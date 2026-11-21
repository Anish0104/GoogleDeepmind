// OWNER: Dev 1. Stores 1-second MediaRecorder chunks per camera and joins them into
// data/scenes/<id>/cam-<X>.webm (or .mp4 from iPhones) when the phone stops.
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CameraId } from "@/lib/types";
import { loadManifest, scenePath } from "@/lib/store/scene";
import { probe, remux } from "@/lib/video/ffmpeg";

/** A request the phone got wrong (maps to HTTP 400). */
export class IngestError extends Error {
  override name = "IngestError";
}

export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;
const MAX_SEQ = 100_000;

const CameraSchema = z.enum(["A", "B", "C", "D"]);

function extFor(mimeType: string): "webm" | "mp4" {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  if (base === "video/webm" || base === "audio/webm") return "webm";
  if (base === "video/mp4" || base === "audio/mp4") return "mp4";
  throw new IngestError(`unsupported chunk type ${JSON.stringify(mimeType)}; expected video/webm or video/mp4`);
}

const chunkDir = (sceneId: string, camera: CameraId) => scenePath(sceneId, `chunks/cam-${camera}`);

async function checkCamera(sceneId: string, camera: CameraId): Promise<void> {
  const manifest = await loadManifest(sceneId);
  if (!manifest.cameras.includes(camera)) {
    throw new IngestError(`camera ${camera} is not part of scene ${sceneId} (${manifest.cameras.join(", ")})`);
  }
}

export interface ChunkInput {
  sceneId: string;
  camera: CameraId;
  seq: number;
  data: Uint8Array;
  mimeType: string;
}

/** Saves one chunk as chunks/cam-<X>/<seq>.<ext>. Re-uploading the same seq overwrites it. */
export async function saveChunk(input: ChunkInput): Promise<{ bytes: number }> {
  const camera = CameraSchema.parse(input.camera);
  const seq = z.number().int().min(0).max(MAX_SEQ).parse(input.seq);
  if (input.data.byteLength === 0) throw new IngestError("empty chunk");
  if (input.data.byteLength > MAX_CHUNK_BYTES) throw new IngestError(`chunk is over ${MAX_CHUNK_BYTES} bytes`);
  const ext = extFor(input.mimeType);
  await checkCamera(input.sceneId, camera);

  const dir = chunkDir(input.sceneId, camera);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${String(seq).padStart(6, "0")}.${ext}`);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, input.data);
  await rename(tmp, file);
  return { bytes: input.data.byteLength };
}

export interface FinalizeResult {
  file: string;
  chunks: number;
  /** Sequence numbers that never arrived (gaps before the last chunk). */
  missing: number[];
  durationS: number;
  /** False if the container could not be rewritten and the joined chunks were kept as-is. */
  remuxed: boolean;
}

/** Joins a camera's chunks in seq order into cam-<X>.<ext> and fixes the container. */
export async function finalizeCamera(sceneId: string, rawCamera: CameraId): Promise<FinalizeResult> {
  const camera = CameraSchema.parse(rawCamera);
  await checkCamera(sceneId, camera);

  const dir = chunkDir(sceneId, camera);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    names = [];
  }
  const chunks = names
    .map((n) => /^(\d{6})\.(webm|mp4)$/.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ seq: Number(m[1]), ext: m[2] as "webm" | "mp4", name: m[0] }))
    .sort((a, b) => a.seq - b.seq);
  if (chunks.length === 0) throw new IngestError(`no chunks received for camera ${camera} in scene ${sceneId}`);
  const exts = new Set(chunks.map((c) => c.ext));
  if (exts.size > 1) throw new IngestError(`camera ${camera} sent both webm and mp4 chunks`);
  const ext = chunks[0]!.ext;

  const present = new Set(chunks.map((c) => c.seq));
  const missing: number[] = [];
  for (let s = 0; s < chunks[chunks.length - 1]!.seq; s++) if (!present.has(s)) missing.push(s);

  const joined = path.join(dir, `joined.${ext}`);
  const out = await open(joined, "w");
  try {
    for (const c of chunks) await out.write(await readFile(path.join(dir, c.name)));
  } finally {
    await out.close();
  }

  const file = scenePath(sceneId, `cam-${camera}.${ext}`);
  const other = scenePath(sceneId, `cam-${camera}.${ext === "webm" ? "mp4" : "webm"}`);
  await rm(other, { force: true }); // a stale file in the other container would shadow this one
  let remuxed = true;
  try {
    await remux(joined, file);
    await rm(joined, { force: true });
  } catch {
    remuxed = false;
    await rename(joined, file);
  }

  const { durationS } = await probe(file);
  return { file, chunks: chunks.length, missing, durationS, remuxed };
}
