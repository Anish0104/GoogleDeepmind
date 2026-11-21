// OWNER: Dev 2. Synthetic grids with known truth, for testing without model calls.
//
// Model of the simulated world (all documented assumptions):
// - Truth events are state changes of one (entity, predicate). Event has no predicate field, so the
//   predicate is inferred: location if a value is a zone (A-F) or a location question value, otherwise
//   heldBy/state if a value matches that predicate's question values for the entity. A value that
//   matches several predicates is an error; an event matching none is ignored (no question asks about it).
// - For each (entity, predicate) the event list is assumed complete: before the first event the state
//   is that event's `from`, unless `from` is an unknown token ("", "unknown", "?"), then it is unknown.
//   An entity/predicate with no events is unknown for the whole scene. Nothing is ever invented.
// - A slice [t, t + SLICE_S) shows the state at its midpoint.
// - Cameras see the whole room unless occluded. "visible" is true when the camera is not occluded and
//   the entity's zone is known, false when occluded, otherwise unknown.
// - Answers: yes 0.95, no 0.05, unknown 0.5, then logit-space Gaussian noise with sd noise * 1.5.
// - Occluded cameras have low pVisible and answers squashed to [0.35, 0.65]: never strong evidence.
// - Shared errors flip a known answer on every unoccluded camera at once, for one question over one
//   2 s block, with probability sharedErrorRate. Unknown answers are not flipped.
// - Randomness is a hash of (seed, purpose, camera, question, time), so rows do not depend on loop
//   order and changing one camera's occlusion leaves other cameras' rows unchanged.
import type { CameraId, Event, GridRow, Question } from "@/lib/types";
import { LIMITS, ZONES } from "@/lib/config";
import { CAMERA_IDS, PREDICATES, isUnknownValue, normText, normValue, toZone } from "@/lib/inference/grid";
import { overlaps } from "@/lib/inference/window";

export interface FakeGridOptions {
  sceneId: string;
  cameras: CameraId[];
  durationS: number;
  truth: Event[];
  questions: Question[];
  noise: number; // 0-1
  sharedErrorRate: number; // errors shared between cameras
  occluded?: { camera: CameraId; window: [number, number] }[];
  seed?: number;
}

const P_YES = 0.95;
const P_NO = 0.05;
const P_UNKNOWN = 0.5;
const LOGIT_SD_AT_FULL_NOISE = 1.5;
const OCCLUDED_SQUASH = 0.2;
const OCCLUDED_RANGE: [number, number] = [0.35, 0.65];
const VIS_CLEAR = 0.92;
const VIS_CLEAR_RANGE: [number, number] = [0.65, 1];
const VIS_OCCLUDED = 0.1;
const VIS_OCCLUDED_RANGE: [number, number] = [0, 0.4];
const SHARED_ERROR_BLOCK_S = 2;
const NEGATIVE_VISIBLE_VALUES = new Set(["no", "false", "hidden", "not visible", "invisible"]);

type StatePredicate = Exclude<Question["predicate"], "visible">;
const STATE_PREDICATES: readonly StatePredicate[] = ["location", "heldBy", "state"];

// ---------- deterministic keyed randomness ----------

/** FNV-1a then a murmur-style finaliser: a well-mixed 32-bit hash of the key. */
function hash32(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform in [0, 1). */
const uniform = (key: string): number => hash32(key) / 4294967296;

/** Standard normal via Box-Muller on two keyed uniforms. */
function gaussian(key: string): number {
  const u1 = Math.max(uniform(`${key}|u1`), 1e-12);
  const u2 = uniform(`${key}|u2`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const clamp = (x: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, x));
const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// ---------- validation ----------

function fail(msg: string): never {
  throw new Error(`fakeGrid: ${msg}`);
}

function validate(o: FakeGridOptions): void {
  if (typeof o.sceneId !== "string" || o.sceneId === "") fail("sceneId is required");
  if (!Number.isFinite(o.durationS) || o.durationS < 0) fail(`durationS must be finite and >= 0, got ${o.durationS}`);
  for (const [name, v] of [
    ["noise", o.noise],
    ["sharedErrorRate", o.sharedErrorRate],
  ] as const)
    if (!Number.isFinite(v) || v < 0 || v > 1) fail(`${name} must be in [0, 1], got ${v}`);
  if (o.seed !== undefined && !Number.isFinite(o.seed)) fail(`seed must be finite, got ${o.seed}`);

  const cams = new Set<string>();
  for (const c of o.cameras) {
    if (!CAMERA_IDS.includes(c)) fail(`unknown camera ${String(c)}`);
    if (cams.has(c)) fail(`duplicate camera ${c}`);
    cams.add(c);
  }

  const ids = new Set<string>();
  for (const q of o.questions) {
    if (typeof q.id !== "string" || q.id === "") fail("every question needs an id");
    if (typeof q.entityId !== "string" || q.entityId === "") fail(`question ${q.id} needs an entityId`);
    if (!PREDICATES.includes(q.predicate)) fail(`question ${q.id} has unknown predicate ${String(q.predicate)}`);
    if (ids.has(q.id)) fail(`duplicate question id ${q.id}`);
    ids.add(q.id);
  }

  for (const occ of o.occluded ?? []) {
    if (!cams.has(occ.camera)) fail(`occlusion for camera ${occ.camera}, which is not in cameras`);
    const [a, b] = occ.window;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) fail(`bad occlusion window [${a}, ${b}]`);
  }
}

// ---------- truth timeline ----------

interface Chain {
  /** State before the first event (null = unknown). */
  initial: string | null;
  events: { t: number; to: string | null }[];
}

type Timeline = Map<string, Chain>; // key `${entityId}|${predicate}`

function buildTimeline(o: FakeGridOptions): Timeline {
  // Value domains per entity and predicate, from the questions asked.
  const domains = new Map<string, Set<string>>();
  for (const q of o.questions) {
    if (q.predicate === "visible") continue;
    const key = `${q.entityId}|${q.predicate}`;
    if (!domains.has(key)) domains.set(key, new Set());
    domains.get(key)!.add(normValue(q.predicate, q.value));
  }
  const inDomain = (entityId: string, p: StatePredicate, v: string): boolean => {
    if (isUnknownValue(v)) return false;
    const n = normValue(p, v);
    if (p === "location" && toZone(n) !== null && (ZONES as readonly string[]).includes(n)) return true;
    return domains.get(`${entityId}|${p}`)?.has(n) ?? false;
  };

  const grouped = new Map<string, { e: Event; p: StatePredicate }[]>();
  for (const e of o.truth) {
    if (typeof e.entityId !== "string" || e.entityId === "") fail("every truth event needs an entityId");
    if (!Number.isFinite(e.t) || e.t < 0 || e.t > o.durationS)
      fail(`event for ${e.entityId} at t=${e.t} is outside [0, ${o.durationS}]`);
    if (typeof e.from !== "string" || typeof e.to !== "string") fail(`event for ${e.entityId} needs from and to`);

    const preds = STATE_PREDICATES.filter((p) => inDomain(e.entityId, p, e.from) || inDomain(e.entityId, p, e.to));
    if (preds.length > 1)
      fail(`event ${e.entityId} ${e.from}->${e.to} at ${e.t} is ambiguous between ${preds.join(", ")}`);
    const p = preds[0];
    const same = p ? normValue(p, e.from) === normValue(p, e.to) : normText(e.from) === normText(e.to);
    if (same) fail(`event ${e.entityId} ${e.from}->${e.to} at ${e.t} changes nothing`);
    if (!p) continue; // no question asks about this value: it cannot affect any row

    const key = `${e.entityId}|${p}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ e, p });
  }

  const timeline: Timeline = new Map();
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.e.t - b.e.t);
    const p = sorted[0]!.p;
    const known = (v: string) => (isUnknownValue(v) ? null : normValue(p, v));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!.e;
      const cur = sorted[i]!.e;
      if (cur.t === prev.t) fail(`two ${key} events at t=${cur.t}`);
      const prevTo = known(prev.to);
      const curFrom = known(cur.from);
      if (prevTo !== null && curFrom !== null && prevTo !== curFrom)
        fail(`${key} event at ${cur.t} starts from ${cur.from} but the previous event ended at ${prev.to}`);
    }
    timeline.set(key, {
      initial: known(sorted[0]!.e.from),
      events: sorted.map(({ e }) => ({ t: e.t, to: known(e.to) })),
    });
  }
  return timeline;
}

function stateAt(timeline: Timeline, entityId: string, p: StatePredicate, tau: number): string | null {
  const chain = timeline.get(`${entityId}|${p}`);
  if (!chain) return null;
  let state = chain.initial;
  for (const ev of chain.events) {
    if (ev.t > tau) break;
    state = ev.to;
  }
  return state;
}

type Truth = "yes" | "no" | "unknown";

function truthFor(timeline: Timeline, q: Question, tau: number, occluded: boolean): Truth {
  if (q.predicate === "visible") {
    let v: Truth;
    if (occluded) v = "no";
    else {
      const zone = stateAt(timeline, q.entityId, "location", tau);
      v = zone !== null && toZone(zone) !== null ? "yes" : "unknown";
    }
    if (v !== "unknown" && NEGATIVE_VISIBLE_VALUES.has(normText(q.value))) v = v === "yes" ? "no" : "yes";
    return v;
  }
  const s = stateAt(timeline, q.entityId, q.predicate, tau);
  if (s === null) return "unknown";
  return s === normValue(q.predicate, q.value) ? "yes" : "no";
}

// ---------- generator ----------

export function fakeGrid(options: FakeGridOptions): GridRow[] {
  validate(options);
  const { sceneId, cameras, durationS, questions, noise, sharedErrorRate } = options;
  const seed = options.seed ?? 0;
  const timeline = buildTimeline(options);
  if (cameras.length === 0 || questions.length === 0 || durationS === 0) return [];

  const slices = Math.ceil(durationS / LIMITS.SLICE_S - 1e-9);
  const occlusions = options.occluded ?? [];
  const rows: GridRow[] = [];

  for (let i = 0; i < slices; i++) {
    const t = i * LIMITS.SLICE_S;
    const slice: [number, number] = [t, t + LIMITS.SLICE_S];
    const tau = t + LIMITS.SLICE_S / 2;
    const block = Math.floor(t / SHARED_ERROR_BLOCK_S);

    for (const camera of cameras) {
      const occluded = occlusions.some((o) => o.camera === camera && overlaps(o.window, slice));

      for (const q of questions) {
        let truth = truthFor(timeline, q, tau, occluded);
        const sharedError =
          !occluded && truth !== "unknown" && uniform(`${seed}|shared|${q.id}|${block}`) < sharedErrorRate;
        if (sharedError) truth = truth === "yes" ? "no" : "yes";

        let p = truth === "yes" ? P_YES : truth === "no" ? P_NO : P_UNKNOWN;
        const squash = occluded && q.predicate !== "visible";
        if (squash) p = P_UNKNOWN + (p - P_UNKNOWN) * OCCLUDED_SQUASH;
        if (noise > 0)
          p = logistic(logit(p) + noise * LOGIT_SD_AT_FULL_NOISE * gaussian(`${seed}|yes|${camera}|${q.id}|${t}`));
        if (squash) p = clamp(p, OCCLUDED_RANGE);

        const g = gaussian(`${seed}|vis|${camera}|${q.entityId}|${t}`);
        const pVisible = occluded
          ? clamp(VIS_OCCLUDED + noise * 0.1 * Math.abs(g), VIS_OCCLUDED_RANGE)
          : clamp(VIS_CLEAR + noise * 0.05 * g, VIS_CLEAR_RANGE);

        rows.push({ sceneId, camera, t, questionId: q.id, pYes: clamp(p, [0, 1]), pVisible });
      }
    }
  }
  return rows;
}
