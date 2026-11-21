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

// ---------- whole-file upload (one video per camera, after the scene) ----------

export const MAX_RECORDING_BYTES = 500 * 1024 * 1024;

/** Container of an uploaded recording, from its MIME type or, if the browser sent none, its file name. */
function recordingKind(mimeType: string, fileName?: string): "webm" | "mp4" | "mov" {
  const base = mimeType.split(";")[0]!.trim().toLowerCase();
  if (base === "video/webm") return "webm";
  if (base === "video/mp4") return "mp4";
  if (base === "video/quicktime") return "mov";
  if (base === "" || base === "application/octet-stream") {
    const ext = path.extname(fileName ?? "").slice(1).toLowerCase();
    if (ext === "webm" || ext === "mp4" || ext === "mov") return ext;
  }
  throw new IngestError(`unsupported video type ${JSON.stringify(mimeType || fileName || "")}; expected webm, mp4 or mov`);
}

export interface RecordingInput {
  sceneId: string;
  camera: CameraId;
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
}

export interface RecordingResult {
  file: string;
  durationS: number;
  hasAudio: boolean;
  /** Set when the recording cannot be clap-synced (no audio) and the scene is not presynced. */
  warning?: string;
}

/**
 * Saves a whole recording as the camera's cam-<X>.webm or cam-<X>.mp4 (a .mov is rewritten to mp4
 * without re-encoding), the same file the chunk upload produces, so sync and perception run unchanged.
 * The file is checked to be a playable video before it replaces any earlier recording of that camera.
 */
export async function saveRecording(input: RecordingInput): Promise<RecordingResult> {
  const camera = CameraSchema.parse(input.camera);
  if (input.data.byteLength === 0) throw new IngestError("empty file");
  if (input.data.byteLength > MAX_RECORDING_BYTES) throw new IngestError(`file is over ${MAX_RECORDING_BYTES / 1024 / 1024} MB`);
  const kind = recordingKind(input.mimeType, input.fileName);
  await checkCamera(input.sceneId, camera);
  const manifest = await loadManifest(input.sceneId);

  const dir = scenePath(input.sceneId, "uploads");
  await mkdir(dir, { recursive: true });
  const stamp = `${process.pid}-${Date.now()}`;
  const upload = path.join(dir, `cam-${camera}-${stamp}.${kind}`);
  await writeFile(upload, input.data);
  const ext = kind === "webm" ? "webm" : "mp4";
  const staged = path.join(dir, `cam-${camera}-${stamp}.out.${ext}`);
  try {
    try {
      await remux(upload, staged); // fixes the container (and turns .mov into .mp4)
    } catch {
      throw new IngestError("not a playable video (could not read the file)");
    }
    const info = await probe(staged).catch(() => null);
    if (!info || info.width === undefined || !(info.durationS > 0)) throw new IngestError("not a playable video (no video track)");

    const file = scenePath(input.sceneId, `cam-${camera}.${ext}`);
    await rm(scenePath(input.sceneId, `cam-${camera}.${ext === "webm" ? "mp4" : "webm"}`), { force: true });
    await rename(staged, file);
    const presynced = (manifest as { presynced?: boolean }).presynced === true;
    return {
      file,
      durationS: info.durationS,
      hasAudio: info.hasAudio,
      ...(!info.hasAudio && !presynced
        ? { warning: "no audio track: clap sync needs one, so this camera can only be synced by the screen flash" }
        : {}),
    };
  } finally {
    await rm(upload, { force: true });
    await rm(staged, { force: true });
  }
}
