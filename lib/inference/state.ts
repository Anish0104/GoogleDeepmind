// OWNER: Dev 2. Simple event tracking: each object's zone over time (no teleporting) turned into events.
//
// Algorithm (per entity, location questions whose value is a zone A-F; other questions are ignored):
// 1. Per slice and camera, a camera votes for zone z when its view is usable (lowest pVisible over its
//    location rows >= USABLE), pYes(z) >= CLEAR, and every other asked zone is below 0.5.
//    Duplicate rows are collapsed first, so a camera counts once per slice.
// 2. Per slice: all voting cameras agree -> observed zone (strength = weakest voter's pYes);
//    voters disagree -> ambiguous; no voters -> unobserved. Cameras are never averaged.
// 3. Hysteresis state machine: a new zone is accepted only after CONFIRM_SLICES consecutive
//    observations of it (unobserved slices neither confirm nor reset; ambiguous slices reset).
//    This removes single-frame spikes and jitter.
// 4. Events: when an accepted zone replaces a known one, emit {from, to, t} where t is the first
//    sampled slice of the confirming run, confidence is the weakest observation behind it (last
//    sighting of the old zone and every confirming slice), and cameras are those that voted for the
//    new zone in the confirming run. The first zone ever accepted (from unknown) is not an event.
//
// No teleporting: no zone layout or adjacency exists in lib/config.ts or lib/types.ts, so every
// direct zone change is treated as reachable and NO intermediate zones are invented. What we do
// enforce: one zone at a time, no change without sustained observation, and if the object went
// unobserved for more than MAX_UNSEEN_S between the old and new zone, the move is suppressed
// (state updates silently) because its time cannot be placed honestly.
import type { CameraId, Event, GridRow, Question, Zone } from "@/lib/types";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { CAMERA_IDS, indexGrid, indexQuestions, toZone } from "@/lib/inference/grid";

const CONFIRM_SLICES = 2;
const MAX_UNSEEN_S = 2;
const OTHER_ZONE_MAX = 0.5;

interface Observation {
  kind: "zone" | "ambiguous" | "none";
  t: number;
  zone?: Zone;
  strength?: number;
  cameras?: CameraId[];
}

function observe(t: number, byCamera: Map<CameraId, Map<Zone, { pYes: number; pVisible: number }>>): Observation {
  const votes: { camera: CameraId; zone: Zone; pYes: number }[] = [];
  for (const camera of CAMERA_IDS) {
    const zones = byCamera.get(camera);
    if (!zones || zones.size === 0) continue;
    const vals = [...zones.entries()];
    if (Math.min(...vals.map(([, v]) => v.pVisible)) < THRESHOLDS.USABLE) continue;
    vals.sort((a, b) => b[1].pYes - a[1].pYes);
    const [best, second] = vals;
    if (best![1].pYes < THRESHOLDS.CLEAR) continue;
    if (second && second[1].pYes >= OTHER_ZONE_MAX) continue;
    votes.push({ camera, zone: best![0], pYes: best![1].pYes });
  }
  if (votes.length === 0) return { kind: "none", t };
  if (votes.some((v) => v.zone !== votes[0]!.zone)) return { kind: "ambiguous", t };
  return {
    kind: "zone",
    t,
    zone: votes[0]!.zone,
    strength: Math.min(...votes.map((v) => v.pYes)),
    cameras: votes.map((v) => v.camera),
  };
}

function track(entityId: string, observations: Observation[]): Event[] {
  const events: Event[] = [];
  let current: Zone | null = null;
  let lastSeen: Observation | null = null;
  let candidate: Observation[] = [];

  for (const o of observations) {
    if (o.kind === "none") continue;
    if (o.kind === "ambiguous") {
      candidate = [];
      continue;
    }
    if (o.zone === current) {
      lastSeen = o;
      candidate = [];
      continue;
    }
    candidate = candidate.length > 0 && candidate[0]!.zone === o.zone ? [...candidate, o] : [o];
    if (candidate.length < CONFIRM_SLICES) continue;

    const start = candidate[0]!;
    if (current !== null && lastSeen !== null) {
      const unseen = start.t - (lastSeen.t + LIMITS.SLICE_S);
      if (unseen <= MAX_UNSEEN_S + 1e-9) {
        const cams = new Set(candidate.flatMap((c) => c.cameras ?? []));
        events.push({
          entityId,
          from: current,
          to: o.zone!,
          t: start.t,
          confidence: Math.min(lastSeen.strength!, ...candidate.map((c) => c.strength!)),
          cameras: CAMERA_IDS.filter((c) => cams.has(c)),
        });
      }
    }
    current = o.zone!;
    lastSeen = o;
    candidate = [];
  }
  return events;
}

export function stateModel(rows: GridRow[], questions: Question[]): Event[] {
  const { cells, sceneIds } = indexGrid(rows);
  if (sceneIds.size > 1) throw new Error(`stateModel: rows span several scenes (${[...sceneIds].join(", ")})`);

  // Location questions with a zone value, by id.
  const zoneQ = new Map<string, { entityId: string; zone: Zone }>();
  for (const q of indexQuestions(questions).values()) {
    if (q.predicate !== "location") continue;
    const zone = toZone(q.value);
    if (zone !== null) zoneQ.set(q.id, { entityId: q.entityId, zone });
  }

  // entity -> t -> camera -> zone -> reading
  const grid = new Map<string, Map<number, Map<CameraId, Map<Zone, { pYes: number; pVisible: number }>>>>();
  for (const c of cells) {
    const q = zoneQ.get(c.questionId);
    if (!q) continue;
    if (!grid.has(q.entityId)) grid.set(q.entityId, new Map());
    const byT = grid.get(q.entityId)!;
    if (!byT.has(c.t)) byT.set(c.t, new Map());
    const byCam = byT.get(c.t)!;
    if (!byCam.has(c.camera)) byCam.set(c.camera, new Map());
    const byZone = byCam.get(c.camera)!;
    if (byZone.has(q.zone)) {
      // Two questions for the same zone: keep the weaker answer and lower visibility (conservative).
      const prev = byZone.get(q.zone)!;
      byZone.set(q.zone, { pYes: Math.min(prev.pYes, c.pYes), pVisible: Math.min(prev.pVisible, c.pVisible) });
    } else byZone.set(q.zone, { pYes: c.pYes, pVisible: c.pVisible });
  }

  const events: Event[] = [];
  for (const entityId of [...grid.keys()].sort()) {
    const byT = grid.get(entityId)!;
    const obs = [...byT.keys()].sort((a, b) => a - b).map((t) => observe(t, byT.get(t)!));
    events.push(...track(entityId, obs));
  }
  return events.sort((a, b) => a.t - b.t || (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
}
