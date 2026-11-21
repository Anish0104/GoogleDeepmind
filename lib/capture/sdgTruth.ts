// OWNER: Dev 1. Answer key for NVIDIA SDG-Warehouse forklift-human near-miss runs, from the
// dataset's per-frame 3D boxes (object_detection.jsonl). Pure functions: no files, no models.
// Geometry is on the floor plane (x, y in metres). Boxes are oriented: corner = local @ transform
// (row vectors, translation in the last row), as Isaac Replicator writes them.
// The answer key is for scoring only; nothing in the pipeline or any agent may read it.
import { z } from "zod";

export type XY = [number, number];
export type Answer = "yes" | "no" | "unclear";

export const SDG = {
  FPS: 30,
  SLICE_S: 0.5,
  /** Motion questions look at one slice before and two after (lattice contextSlices = 4). */
  CONTEXT_BEFORE_S: 0.5,
  CONTEXT_AFTER_S: 1.5,
  /**
   * Boxes are looser than the meshes (swinging arms, forks), and in this simulation the forklift does not
   * collide with the worker: its forks pass under or beside them. Checked on frames: overlaps up to ~0.5 m
   * still show a visible gap on the eye-level cameras; ~1 m is the forks running under the worker's feet.
   * Contact ("the forks reach the worker"): footprints overlap by at least CONTACT_OVERLAP_M for
   * CONTACT_MIN_FRAMES frames in a row. Clearly not touching: at least CLEAR_M apart. Between: "unclear".
   */
  CONTACT_OVERLAP_M: 0.5,
  CONTACT_MIN_FRAMES: 3,
  CLEAR_M: 0.3,
  /** A run is a near miss only if the footprints stay at least this far apart the whole time. */
  NEAR_MISS_MIN_GAP_M: 0.1,
  /** A worker already against the forklift this early is its driver, not a pedestrian. */
  RIDER_WINDOW_S: 0.5,
  /** "Within about one metre": yes when the slice's closest gap is within NEAR_M, no when it stays beyond FAR_M. */
  NEAR_M: 1.0,
  FAR_M: 1.5,
  /** Forklift moving: mean speed at least MOVING_MPS; still: never above STILL_MPS. */
  MOVING_MPS: 0.2,
  STILL_MPS: 0.05,
  /** The forklift has stopped once it stays still this long. */
  STOP_HOLD_S: 0.5,
  /** Worker dodging: peak speed at least DODGE_MPS; not dodging: never above CALM_MPS. */
  DODGE_MPS: 0.6,
  CALM_MPS: 0.3,
  /** Visible when the mask covers at least this share of the frame (1500 px at 1080p); hidden at or below 300 px. */
  VISIBLE_FRAC: 1500 / (1920 * 1080),
  HIDDEN_FRAC: 300 / (1920 * 1080),
} as const;

const Box3dSchema = z.object({
  x_min: z.number(),
  x_max: z.number(),
  y_min: z.number(),
  y_max: z.number(),
  z_min: z.number(),
  z_max: z.number(),
  transform: z.array(z.array(z.number()).length(4)).length(4),
});
export type Box3d = z.infer<typeof Box3dSchema>;

const AgentSchema = z.object({
  label: z.object({ class: z.string() }),
  annotators: z.object({ bounding_box_3d_fast: Box3dSchema }),
});
const DetectionFrameSchema = z.object({ agents: z.record(z.string(), AgentSchema) });
export type DetectionFrame = z.infer<typeof DetectionFrameSchema>;

/** One object_detection.jsonl file: one frame per line. */
export function parseDetections(jsonl: string): DetectionFrame[] {
  return jsonl
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l, i) => {
      const r = DetectionFrameSchema.safeParse(JSON.parse(l));
      if (!r.success) throw new Error(`object_detection line ${i + 1}: ${r.error.message}`);
      return r.data;
    });
}

/** The box's floor footprint: 4 world (x, y) corners in order around the box. */
export function footprint(b: Box3d): XY[] {
  const T = b.transform;
  const corners: XY[] = [[b.x_min, b.y_min], [b.x_max, b.y_min], [b.x_max, b.y_max], [b.x_min, b.y_max]];
  return corners.map(([x, y]) => [x * T[0]![0]! + y * T[1]![0]! + T[3]![0]!, x * T[0]![1]! + y * T[1]![1]! + T[3]![1]!]);
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function inside(p: XY, poly: XY[]): boolean {
  const s = poly.map((a, i) => cross(a, poly[(i + 1) % poly.length]!, p));
  return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}

function segDist(p: XY, a: XY, b: XY): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * How deep two convex polygons overlap: the smallest overlap of their projections over all edge
 * normals (separating-axis test). Positive = overlapping by that much; 0 or less = apart.
 */
export function penetration(a: XY[], b: XY[]): number {
  let best = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len === 0) continue;
      const n: XY = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const pa = a.map((v) => v[0] * n[0] + v[1] * n[1]);
      const pb = b.map((v) => v[0] * n[0] + v[1] * n[1]);
      best = Math.min(best, Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)));
    }
  }
  return best;
}

/** Shortest distance between two convex polygons; 0 when they touch or overlap. */
export function polygonGap(a: XY[], b: XY[]): number {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
  const edges = (poly: XY[]) => poly.map((p, i): [XY, XY] => [p, poly[(i + 1) % poly.length]!]);
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) if (segmentsCross(p, q, r, s)) return 0;
  let best = Infinity;
  for (const p of a) for (const [r, s] of edges(b)) best = Math.min(best, segDist(p, r, s));
  for (const p of b) for (const [r, s] of edges(a)) best = Math.min(best, segDist(p, r, s));
  return best;
}

export interface TrackPoint {
  t: number;
  /** Footprint centres. */
  worker: XY;
  forklift: XY;
  /** Floor distance between the two footprints (m); 0 when they overlap. */
  gapM: number;
  /** How deep the footprints overlap (m); 0 when apart. */
  overlapM: number;
}

const centre = (f: XY[]): XY => [f.reduce((s, p) => s + p[0], 0) / f.length, f.reduce((s, p) => s + p[1], 0) / f.length];

/** Worker = the one "character", forklift = the one "robot". Boxes are in world space, so any camera's file will do. */
export function trackRun(frames: DetectionFrame[], fps: number = SDG.FPS): TrackPoint[] {
  return frames.map((f, i) => {
    const of = (cls: string, name: string) => {
      const found = Object.values(f.agents).filter((a) => a.label.class === cls);
      if (found.length !== 1) throw new Error(`frame ${i}: expected one ${name} (class "${cls}"), found ${found.length}`);
      return footprint(found[0]!.annotators.bounding_box_3d_fast);
    };
    const w = of("character", "worker");
    const r = of("robot", "forklift");
    return { t: i / fps, worker: centre(w), forklift: centre(r), gapM: polygonGap(w, r), overlapM: Math.max(0, penetration(w, r)) };
  });
}

/** Speed (m/s) per frame, by central difference over +-2 frames (clamped at the ends). */
export function speeds(track: TrackPoint[], who: "worker" | "forklift"): number[] {
  const n = track.length;
  return track.map((_, i) => {
    const a = track[Math.max(0, i - 2)]!;
    const b = track[Math.min(n - 1, i + 2)]!;
    const dt = b.t - a.t;
    return dt > 0 ? Math.hypot(b[who][0] - a[who][0], b[who][1] - a[who][1]) / dt : 0;
  });
}

export interface RunSummary {
  durationS: number;
  minGapM: number;
  minGapT: number;
  maxOverlapM: number;
  /** contact: a clear overlap; near_miss: always NEAR_MISS_MIN_GAP_M apart; unclear: a brush in between. */
  outcome: "contact" | "near_miss" | "unclear";
  /** First and last frame time of clear overlap (contact frames), or null when there is no contact. */
  contact: [number, number] | null;
  /** First time the worker moves at DODGE_MPS or faster, or null if they never do. */
  dodgeStartT: number | null;
  /** First and last time the footprints are within NEAR_M, or null if they never are. */
  near: [number, number] | null;
  /** First time the forklift stays at or below STILL_MPS for STOP_HOLD_S, or null if it never stops. */
  forkliftStopT: number | null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Per frame: part of a run of at least CONTACT_MIN_FRAMES frames overlapping by CONTACT_OVERLAP_M or more. */
export function contactFrames(track: TrackPoint[]): boolean[] {
  const deep = track.map((p) => p.overlapM >= SDG.CONTACT_OVERLAP_M);
  const out = deep.map(() => false);
  for (let i = 0; i < deep.length; ) {
    if (!deep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < deep.length && deep[j]) j++;
    if (j - i >= SDG.CONTACT_MIN_FRAMES) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  return out;
}

/** Why a run is not a usable near-miss scene, or null if it is. */
export function checkRun(track: TrackPoint[], fps: number = SDG.FPS): string | null {
  const early = track.slice(0, Math.max(1, Math.round(SDG.RIDER_WINDOW_S * fps)));
  if (early.some((p) => p.gapM <= 0)) {
    return `worker starts on or against the forklift (footprints overlap in the first ${SDG.RIDER_WINDOW_S} s): probably its driver`;
  }
  return null;
}

export function summarizeRun(track: TrackPoint[], fps: number = SDG.FPS): RunSummary {
  if (track.length === 0) throw new Error("empty track");
  let k = 0;
  track.forEach((p, i) => {
    if (p.gapM < track[k]!.gapM) k = i;
  });
  const deep = contactFrames(track);
  const touching = track.filter((_, i) => deep[i]);
  const maxOverlap = Math.max(...track.map((p) => p.overlapM));
  const ws = speeds(track, "worker");
  const d = ws.findIndex((v) => v >= SDG.DODGE_MPS);
  const near = track.filter((p) => p.gapM <= SDG.NEAR_M);
  const fs = speeds(track, "forklift");
  const hold = Math.round(SDG.STOP_HOLD_S * fps);
  const stop = fs.findIndex((_, i) => i + hold <= fs.length && fs.slice(i, i + hold).every((v) => v <= SDG.STILL_MPS));
  return {
    durationS: track.length / fps,
    minGapM: r3(track[k]!.gapM),
    minGapT: r3(track[k]!.t),
    maxOverlapM: r3(maxOverlap),
    outcome: touching.length > 0 ? "contact" : track[k]!.gapM >= SDG.NEAR_MISS_MIN_GAP_M ? "near_miss" : "unclear",
    contact: touching.length > 0 ? [r3(touching[0]!.t), r3(touching[touching.length - 1]!.t)] : null,
    dodgeStartT: d < 0 ? null : r3(track[d]!.t),
    near: near.length > 0 ? [r3(near[0]!.t), r3(near[near.length - 1]!.t)] : null,
    forkliftStopT: stop < 0 ? null : r3(track[stop]!.t),
  };
}

export const SDG_STATE_QUESTION_IDS = [
  "forklift:state:near_worker",
  "forklift:state:touching_worker",
  "forklift:state:moving",
  "worker:state:dodging",
] as const;
export type SdgStateQuestionId = (typeof SDG_STATE_QUESTION_IDS)[number];

export interface SliceTruth {
  /** Slice start (s): the slice is [t, t + 0.5). */
  t: number;
  /** The motion questions' window, [t - 0.5, t + 1.5) clipped to the run. */
  window: [number, number];
  gapMinM: number;
  gapMaxM: number;
  forkliftMeanMps: number;
  workerMaxMps: number;
  /** Same for every camera; use only where that camera can see the objects involved. */
  answers: Record<SdgStateQuestionId, Answer>;
}

const band = (yes: boolean, no: boolean): Answer => (yes ? "yes" : no ? "no" : "unclear");

export function sliceTruth(track: TrackPoint[], fps: number = SDG.FPS): SliceTruth[] {
  const dur = track.length / fps;
  const n = Math.floor(dur / SDG.SLICE_S + 1e-9);
  const fv = speeds(track, "forklift");
  const wv = speeds(track, "worker");
  const deep = contactFrames(track);
  const idx = (a: number, b: number) => track.map((p, i) => [p, i] as const).filter(([p]) => p.t >= a - 1e-9 && p.t < b - 1e-9).map(([, i]) => i);
  return Array.from({ length: n }, (_, k) => {
    const t = r3(k * SDG.SLICE_S);
    const inSlice = idx(t, t + SDG.SLICE_S);
    const window: [number, number] = [r3(Math.max(0, t - SDG.CONTEXT_BEFORE_S)), r3(Math.min(dur, t + SDG.CONTEXT_AFTER_S))];
    const inWindow = idx(window[0], window[1]);
    const gaps = inSlice.map((i) => track[i]!.gapM);
    const gapMin = Math.min(...gaps);
    const gapMax = Math.max(...gaps);
    const f = inWindow.map((i) => fv[i]!);
    const fMean = f.reduce((s, v) => s + v, 0) / f.length;
    const fMax = Math.max(...f);
    const wMax = Math.max(...inWindow.map((i) => wv[i]!));
    const touching = band(inSlice.some((i) => deep[i]), gapMin >= SDG.CLEAR_M);
    const moving = band(fMean >= SDG.MOVING_MPS, fMax <= SDG.STILL_MPS);
    return {
      t,
      window,
      gapMinM: r3(gapMin),
      gapMaxM: r3(gapMax),
      forkliftMeanMps: r3(fMean),
      workerMaxMps: r3(wMax),
      answers: {
        // "Is X happening in this clip?": yes if it happens at any point, so both use the slice's closest gap.
        "forklift:state:near_worker": band(gapMin <= SDG.NEAR_M, gapMin >= SDG.FAR_M),
        "forklift:state:touching_worker": touching,
        "forklift:state:moving": moving,
        "worker:state:dodging": band(wMax >= SDG.DODGE_MPS, wMax <= SDG.CALM_MPS),
      },
    };
  });
}

/** Visible / hidden from mask pixels; the band between is "unclear" and should not be scored. */
export function visibilityAnswer(pixels: number, framePixels: number): Answer {
  const f = pixels / framePixels;
  return band(f >= SDG.VISIBLE_FRAC, f <= SDG.HIDDEN_FRAC);
}
