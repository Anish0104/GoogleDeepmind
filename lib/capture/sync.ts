// OWNER: Dev 1. Clap cross-correlation, refined by the screen flash; writes sync.json.
//
// Convention: the synced timeline is the first camera's local time. For every camera,
//   syncedT = localT - offsetS   (offsetS > 0 means this camera started recording earlier).
// Clap: sound-onset envelopes are cross-correlated against the reference (1 ms resolution).
// Flash: the first short bright pulse in the video (1 frame resolution). When clap and flash agree
// within ~1.5 frames the clap is used ("both"); otherwise the flash wins, since video is what we align.
// Drift: from the closing flash, when both cameras saw two flashes at least MIN_DRIFT_SPAN_S apart.
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CameraId, SceneManifest, SyncResult } from "@/lib/types";
import { recordingPath } from "@/lib/capture/files";
import { NotFoundError, readJson, writeJson } from "@/lib/store/scene";
import { audio, grayFrames, probe } from "@/lib/video/ffmpeg";

const SAMPLE_RATE = 16_000;
const HOP_S = 0.001;
const COARSE = 10; // coarse pass works on 10 ms bins
const MAX_LAG_S = 20;
const MIN_CLAP_SCORE = 0.25;
const FPS = 30;
const FRAME_S = 1 / FPS;
const FLASH_JUMP = 50; // luma rise (0-255) in one cell between frames
const FLASH_RETURN = 25; // must fall back within this of the pre-flash level...
const FLASH_MAX_S = 0.8; // ...within this long, or it is a lighting change, not a flash
const MIN_DRIFT_SPAN_S = 5;
const MIN_DRIFT_CHANGE_S = 0.1; // one frame at 15 fps (plus slack): smaller changes are frame quantisation

// ---------- audio ----------

/** Reads a 16-bit PCM wav (as written by ffmpeg.audio()) into mono float samples in [-1, 1). */
export function parseWav(buf: Buffer): { sampleRate: number; samples: Float32Array } {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a wav file");
  let off = 12;
  let sampleRate = 0;
  let channels = 1;
  let bits = 16;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}-bit`);
      if (size === 0xffffffff || body + size > buf.length) size = buf.length - body; // streamed wav
      const frames = Math.floor(size / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = buf.readInt16LE(body + i * 2 * channels) / 32768;
      return { sampleRate, samples };
    }
    off = body + size + (size % 2);
  }
  throw new Error("wav has no data chunk");
}

/** Positive jumps in log energy per hop: sharp sounds (claps, knocks) stand out, steady noise does not. */
function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * HOP_S));
  const n = Math.floor(samples.length / hop);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j]! * samples[j]!;
    e[i] = Math.log10(1e-9 + sum / hop);
  }
  const out = new Float32Array(n);
  for (let i = 3; i < n; i++) out[i] = Math.max(0, e[i]! - e[i - 3]!);
  return out;
}

function pool(x: Float32Array, k: number): Float32Array {
  const out = new Float32Array(Math.floor(x.length / k));
  for (let i = 0; i < out.length; i++) {
    let m = 0;
    for (let j = i * k; j < (i + 1) * k; j++) m = Math.max(m, x[j]!);
    out[i] = m;
  }
  return out;
}

/**
 * The lag in [minLag, maxLag] maximising sum(a[i] * b[i + lag]), normalised to [0, 1] by the norms.
 * A positive lag means events in b happen `lag` samples later than in a.
 */
export function bestLag(a: Float32Array, b: Float32Array, minLag: number, maxLag: number): { lag: number; score: number } {
  let na = 0;
  let nb = 0;
  for (const v of a) na += v * v;
  for (const v of b) nb += v * v;
  const norm = Math.sqrt(na * nb) || 1;
  let best = { lag: 0, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    const i0 = Math.max(0, -lag);
    const i1 = Math.min(a.length, b.length - lag);
    for (let i = i0; i < i1; i++) s += a[i]! * b[i + lag]!;
    if (s > best.score) best = { lag, score: s };
  }
  return { lag: best.lag, score: best.score / norm };
}

/** Offset (s) of `cam` relative to `ref` from the clap, or null if no clear match. */
function clapOffset(ref: Float32Array, cam: Float32Array): number | null {
  const maxLag = Math.round(MAX_LAG_S / HOP_S);
  const ra = pool(ref, COARSE);
  const ca = pool(cam, COARSE);
  const coarse = bestLag(ra, ca, -Math.round(maxLag / COARSE), Math.round(maxLag / COARSE));
  if (coarse.score < MIN_CLAP_SCORE) return null;
  const c = coarse.lag * COARSE;
  const fine = bestLag(ref, cam, c - 2 * COARSE, c + 2 * COARSE);
  return fine.score < MIN_CLAP_SCORE ? null : fine.lag * HOP_S;
}

// ---------- video ----------

/** Times (s) of short bright pulses: a cell jumps by FLASH_JUMP and falls back within FLASH_MAX_S. */
export function findFlashes(frames: Uint8Array[], fps: number): number[] {
  const maxFrames = Math.round(FLASH_MAX_S * fps);
  const times: number[] = [];
  for (let k = 1; k < frames.length; k++) {
    const prev = frames[k - 1]!;
    const cur = frames[k]!;
    let hit = false;
    for (let c = 0; c < cur.length && !hit; c++) {
      if (cur[c]! - prev[c]! < FLASH_JUMP) continue;
      for (let j = k + 1; j < Math.min(frames.length, k + maxFrames + 1); j++) {
        if (frames[j]![c]! <= prev[c]! + FLASH_RETURN) {
          hit = true;
          break;
        }
      }
    }
    if (hit) {
      times.push(k / fps);
      k += maxFrames; // one pulse, one flash
    }
  }
  return times;
}

/** Drift in s/min from the offsets at the opening and closing flash; 0 below one frame's change. */
export function estimateDrift(startOffsetS: number, endOffsetS: number, spanS: number): number {
  const change = endOffsetS - startOffsetS;
  if (Math.abs(change) < MIN_DRIFT_CHANGE_S || spanS <= 0) return 0;
  return change / (spanS / 60);
}

// ---------- scene ----------

interface CameraSignals {
  camera: CameraId;
  onsets: Float32Array | null;
  flashes: number[];
}

async function signals(camera: CameraId, file: string): Promise<CameraSignals> {
  const wav = path.join(os.tmpdir(), `rashomon-sync-${process.pid}-${camera}-${Date.now()}.wav`);
  let onsets: Float32Array | null = null;
  try {
    if ((await probe(file)).hasAudio) {
      await audio(file, wav, SAMPLE_RATE);
      const { samples, sampleRate } = parseWav(await readFile(wav));
      onsets = onsetEnvelope(samples, sampleRate);
    }
  } finally {
    await rm(wav, { force: true });
  }
  const { frames } = await grayFrames(file, 32, 18, FPS);
  return { camera, onsets, flashes: findFlashes(frames, FPS) };
}

const nearest = (xs: number[], target: number) =>
  xs.reduce<number | null>((b, x) => (b === null || Math.abs(x - target) < Math.abs(b - target) ? x : b), null);

function relate(ref: CameraSignals, cam: CameraSignals): SyncResult {
  const clap = ref.onsets && cam.onsets ? clapOffset(ref.onsets, cam.onsets) : null;

  let flash: number | null = null;
  let camFirst: number | null = null;
  const refFirst = ref.flashes[0];
  if (refFirst !== undefined && cam.flashes.length > 0) {
    camFirst = clap === null ? cam.flashes[0]! : nearest(cam.flashes, refFirst + clap);
    if (camFirst !== null && clap !== null && Math.abs(camFirst - (refFirst + clap)) > 0.5) camFirst = null;
    if (camFirst !== null) flash = camFirst - refFirst;
  }

  let offsetS: number;
  let method: SyncResult["method"];
  if (clap !== null && flash !== null) {
    if (Math.abs(clap - flash) <= 1.5 * FRAME_S) [offsetS, method] = [clap, "both"];
    else [offsetS, method] = [flash, "flash"];
  } else if (clap !== null) [offsetS, method] = [clap, "clap"];
  else if (flash !== null) [offsetS, method] = [flash, "flash"];
  else throw new Error(`camera ${cam.camera}: no clap or flash found to sync against camera ${ref.camera}`);

  let driftPerMin = 0;
  const refLast = ref.flashes[ref.flashes.length - 1];
  if (flash !== null && refFirst !== undefined && refLast !== undefined && refLast - refFirst >= MIN_DRIFT_SPAN_S) {
    const camLast = nearest(cam.flashes, refLast + flash);
    if (camLast !== null && camLast !== camFirst && Math.abs(camLast - (refLast + flash)) <= 0.5) {
      driftPerMin = estimateDrift(flash, camLast - refLast, refLast - refFirst);
    }
  }
  return { camera: cam.camera, offsetS: Math.round(offsetS * 1000) / 1000, driftPerMin, method };
}

/** Syncs every scene camera that has a recording to the first one; writes sync.json. */
export async function syncScene(manifest: SceneManifest): Promise<SyncResult[]> {
  const found = manifest.cameras
    .map((camera) => ({ camera, file: recordingPath(manifest.sceneId, camera, manifest.files) }))
    .filter((c): c is { camera: CameraId; file: string } => c.file !== null);
  if (found.length === 0) throw new Error(`scene ${manifest.sceneId} has no recordings to sync`);

  const sig = await Promise.all(found.map((c) => signals(c.camera, c.file)));
  const ref = sig[0]!;
  const results: SyncResult[] = [
    { camera: ref.camera, offsetS: 0, driftPerMin: 0, method: ref.onsets && ref.flashes.length ? "both" : ref.flashes.length ? "flash" : "clap" },
    ...sig.slice(1).map((s) => relate(ref, s)),
  ];
  await writeJson(manifest.sceneId, "sync.json", results);
  return results;
}

/**
 * Converts a synced time to the camera's own recording time using sync.json:
 * localT = t + offsetS + driftPerMin * t / 60. Without sync.json (single camera, not yet synced)
 * the timelines are taken as equal.
 */
export async function localTime(sceneId: string, camera: CameraId, t: number): Promise<number> {
  let sync: SyncResult[];
  try {
    sync = await readJson<SyncResult[]>(sceneId, "sync.json");
  } catch (e) {
    if (e instanceof NotFoundError) return t;
    throw e;
  }
  const s = sync.find((r) => r.camera === camera);
  if (!s) throw new Error(`camera ${camera} is not in sync.json for scene ${sceneId}`);
  return t + s.offsetS + (s.driftPerMin * t) / 60;
}
