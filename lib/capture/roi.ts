// OWNER: Dev 1. Region of interest per camera: the part of the frame where things move.
// Slices are cropped to it (and scaled up) so small objects fill more of what the model sees.
// Activity = pixels that differ from the per-pixel median background often enough. Frames where
// most of the picture changes at once (a sync flash, lights switching) are ignored.
import { grayFrames, probe, type Box } from "@/lib/video/ffmpeg";

export interface NormBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DIFF = 25; // luma change that counts as "different from background"
const MIN_ACTIVE_FRACTION = 0.03; // a pixel must differ in at least this share of frames
const MARGIN = 0.35; // grow the box by this share of its size on each side
const MIN_SIZE = 0.4; // never crop to less than this share of the frame per axis
const MAX_AREA = 0.8; // a box this big isn't worth cropping to
const SAMPLE_W = 64;
const SAMPLE_H = 48;
const SAMPLE_FPS = 15;
const GLOBAL_CHANGE = 0.4; // a frame where this share of pixels changed is a global event, not motion

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Normalised [0,1] box around moving pixels, or null if nothing moves. */
export function activityBox(frames: Uint8Array[], width: number, height: number, exclude: Set<number>): NormBox | null {
  const n = width * height;
  let used = frames.filter((_, k) => !exclude.has(k));
  if (used.length < 3) return null;
  const bg = new Uint8Array(n);
  const background = () => {
    for (let p = 0; p < n; p++) bg[p] = median(used.map((f) => f[p]!));
  };
  background();
  const changed = (f: Uint8Array) => {
    let c = 0;
    for (let p = 0; p < n; p++) if (Math.abs(f[p]! - bg[p]!) > DIFF) c++;
    return c / n;
  };
  used = used.filter((f) => changed(f) < GLOBAL_CHANGE);
  if (used.length < 3) return null;
  background();

  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let p = 0; p < n; p++) {
    let hits = 0;
    for (const f of used) if (Math.abs(f[p]! - bg[p]!) > DIFF) hits++;
    if (hits / used.length < MIN_ACTIVE_FRACTION) continue;
    const x = p % width;
    const y = Math.floor(p / width);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) return null;

  const grow = (a: number, b: number, size: number): [number, number] => {
    let lo = a / size;
    let hi = (b + 1) / size;
    const m = (hi - lo) * MARGIN;
    lo -= m;
    hi += m;
    if (hi - lo < MIN_SIZE) {
      const c = (lo + hi) / 2;
      lo = c - MIN_SIZE / 2;
      hi = c + MIN_SIZE / 2;
    }
    if (lo < 0) [lo, hi] = [0, hi - lo];
    if (hi > 1) [lo, hi] = [Math.max(0, lo - (hi - 1)), 1];
    return [lo, hi];
  };
  const [nx0, nx1] = grow(x0, x1, width);
  const [ny0, ny1] = grow(y0, y1, height);
  return { x0: nx0, y0: ny0, x1: nx1, y1: ny1 };
}

const even = (v: number) => Math.max(0, Math.floor(v / 2) * 2);

/** Pixel crop box for a recording, or null when cropping wouldn't help (no motion, or motion everywhere). */
export async function sceneRoi(file: string): Promise<Box | null> {
  const { width, height } = await probe(file);
  if (!width || !height) return null;
  const { frames } = await grayFrames(file, SAMPLE_W, SAMPLE_H, SAMPLE_FPS);
  const b = activityBox(frames, SAMPLE_W, SAMPLE_H, new Set());
  if (!b || (b.x1 - b.x0) * (b.y1 - b.y0) > MAX_AREA) return null;
  const x = even(b.x0 * width);
  const y = even(b.y0 * height);
  return { x, y, w: Math.min(even(b.x1 * width) - x, even(width - x)), h: Math.min(even(b.y1 * height) - y, even(height - y)) };
}
