// OWNER: Dev 2. Evidence per camera. Only usable views (visibility >= THRESHOLDS.USABLE) count.
// Never average cameras together.
//
// How a claim is grounded (structured fields only; documented limits):
// 1. Entity: Claim.object must equal a question's entityId, or be a phrase found (whole words) in the
//    question texts of exactly one entity. Entity descriptions are not passed to evidenceFor, so
//    question text is the only human-readable link; if it is ambiguous, nothing is grounded.
// 2. Claimed proposition (predicate = value), from Claim.action, Claim.actor and Claim.text:
//    - move verbs (put, place, move, ...) -> location = the single zone named after to/into/onto/in/at;
//    - take verbs (pick up, grab, hold, ...) -> heldBy = Claim.actor;
//    - give verbs (hand, give, pass) -> heldBy = the single heldBy value named in the text other than the actor;
//    - otherwise, a state value of the entity named in Claim.action -> state = that value.
//    Claim has no structured target field, so the target is read from these strings conservatively:
//    no verb category, zero or several targets, or no question for the target -> not grounded.
// 3. Alternatives: other location values (an object is in one zone) and other heldBy values (one holder).
//    State values are not known to be mutually exclusive, so state claims are never contradicted.
//
// Per camera, slices overlapping the claim window are split into runs of consecutive slices with the
// same usability. Each run is one Evidence record:
// - supports: the best 1 s (two consecutive slices) of pYes(claim), tempered by any alternative seen in
//   the same slice; a single-slice run uses its one slice. Single-frame spikes do not count.
// - contradicts: only if the run is usable, covers the whole claim window, and an alternative was
//   asked about in every slice: the weakest slice of min(pYes(alternative), 1 - pYes(claim)).
//   A low pYes alone is never a contradiction; a partial view never rules anything out.
// - unusable runs carry null scores; ungrounded claims give null scores with visible 0.
// - clipId is a grid reference "grid:<scene>:<camera>:<start>-<end>", not a playable clip. Resolving
//   it to a real clip belongs to the perception/ingest integration (Dev 1 / Dev 3).
import type { CameraId, Claim, Evidence, GridRow, Question } from "@/lib/types";
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { CAMERA_IDS, indexGrid, indexQuestions, normText, normValue, sliceWindow, toZone, type GridCell } from "@/lib/inference/grid";
import { covers, overlaps } from "@/lib/inference/window";

const ARTICLES = /^(?:the|a|an|this|that|his|her|their)\s+/;
const MOVE_VERBS = new Set(["put", "puts", "putting", "place", "placed", "places", "placing", "move", "moved", "moves", "moving", "set", "sets", "drop", "dropped", "drops", "leave", "left", "leaves", "return", "returned", "slide", "slid", "push", "pushed", "carry", "carried"]);
const TAKE_VERBS = new Set(["pick", "picked", "picks", "grab", "grabbed", "grabs", "take", "took", "takes", "taken", "hold", "held", "holds", "lift", "lifted", "lifts"]);
const GIVE_VERBS = new Set(["hand", "handed", "hands", "give", "gave", "gives", "given", "pass", "passed", "passes"]);
const INFLECTIONS = ["", "s", "es", "d", "ed", "ing", "ped", "ted", "ned", "ped over"];
const ZONE_TARGET = /\b(?:to|into|onto|in|at|inside|on)\s+(?:the\s+)?zone\s+([a-z])\b/g;
const SEAM_EPS = 1e-6;

interface Proposition {
  question: Question;
  alternatives: Question[]; // mutually exclusive with the claimed value
}

const words = (s: string) => normText(s).split(" ").filter(Boolean);

/** Whole-word phrase match, allowing simple verb inflections on each word ("open" ~ "opened"). */
function mentions(haystack: string, phrase: string, inflect = false): boolean {
  const h = words(haystack);
  const p = words(phrase);
  if (p.length === 0) return false;
  const eq = (w: string, v: string) => w === v || (inflect && v.length >= 3 && INFLECTIONS.some((s) => w === v + s));
  for (let i = 0; i + p.length <= h.length; i++) if (p.every((v, j) => eq(h[i + j]!, v))) return true;
  return false;
}

function groundEntity(claim: Claim, byEntity: Map<string, Question[]>): string | null {
  const obj = normText(claim.object).replace(ARTICLES, "");
  if (obj === "") return null;
  const byId = [...byEntity.keys()].filter((id) => normText(id.replace(/[_-]+/g, " ")) === obj || normText(id) === obj);
  if (byId.length === 1) return byId[0]!;
  if (byId.length > 1) return null;
  const byText = [...byEntity].filter(([, qs]) => qs.some((q) => mentions(q.text, obj))).map(([id]) => id);
  return byText.length === 1 ? byText[0]! : null;
}

function category(action: string): "move" | "take" | "give" | null {
  const w = words(action);
  if (w.some((x) => GIVE_VERBS.has(x))) return "give";
  if (w.some((x) => TAKE_VERBS.has(x))) return "take";
  if (w.some((x) => MOVE_VERBS.has(x))) return "move";
  return null;
}

function groundProposition(claim: Claim, qs: Question[]): Proposition | null {
  const of = (p: Question["predicate"]) => qs.filter((q) => q.predicate === p);
  const pick = (p: Question["predicate"], value: string): Proposition | null => {
    const same = of(p).filter((q) => normValue(p, q.value) === value);
    if (same.length !== 1) return null; // missing, or two questions for one value: ambiguous
    const exclusive = p === "location" || p === "heldBy";
    const alternatives = exclusive ? of(p).filter((q) => normValue(p, q.value) !== value) : [];
    return { question: same[0]!, alternatives };
  };
  const unique = (xs: string[]) => [...new Set(xs)];

  const kind = category(claim.action);
  if (kind === "move") {
    const text = `${normText(claim.action)} ${normText(claim.text)}`;
    const zones = unique([...text.matchAll(ZONE_TARGET)].map((m) => toZone(m[1]!)).filter((z): z is NonNullable<typeof z> => z !== null));
    return zones.length === 1 ? pick("location", zones[0]!) : null;
  }
  if (kind === "take") return pick("heldBy", normValue("heldBy", claim.actor));
  if (kind === "give") {
    const actor = normValue("heldBy", claim.actor);
    const named = unique(of("heldBy").map((q) => normValue("heldBy", q.value))).filter(
      (v) => v !== actor && mentions(claim.text, v),
    );
    return named.length === 1 ? pick("heldBy", named[0]!) : null;
  }
  const states = unique(of("state").map((q) => normValue("state", q.value))).filter((v) => mentions(claim.action, v, true));
  return states.length === 1 ? pick("state", states[0]!) : null;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const clipRef = (sceneId: string, camera: CameraId, w: [number, number]) => `grid:${sceneId}:${camera}:${fmt(w[0])}-${fmt(w[1])}`;

interface Slice {
  t: number;
  visible: number;
  support: number | null;
  contradiction: number | null; // null when no alternative was asked in this slice
}

/** Group sorted slices into runs of consecutive slices with the same usability. */
function runs<T extends { t: number; usable: boolean }>(slices: T[]): T[][] {
  const out: T[][] = [];
  for (const s of slices) {
    const cur = out.at(-1);
    const prev = cur?.at(-1);
    if (cur && prev && prev.usable === s.usable && s.t - prev.t <= LIMITS.SLICE_S + SEAM_EPS) cur.push(s);
    else out.push([s]);
  }
  return out;
}

function runWindow(run: { t: number }[]): [number, number] {
  return [run[0]!.t, sliceWindow(run.at(-1)!.t)[1]];
}

function sustainedSupport(run: Slice[]): number | null {
  if (run.length === 1) return run[0]!.support;
  let best: number | null = null;
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i]!.support;
    const b = run[i + 1]!.support;
    if (a === null || b === null) continue;
    const pair = Math.min(a, b);
    best = best === null ? pair : Math.max(best, pair);
  }
  return best;
}

function throughoutContradiction(run: Slice[], claim: Claim, window: [number, number]): number | null {
  if (!covers([window], claim.window)) return null;
  let worst = Number.POSITIVE_INFINITY;
  for (const s of run) {
    if (s.contradiction === null) return null;
    worst = Math.min(worst, s.contradiction);
  }
  return worst;
}

function ungrounded(claim: Claim, cells: GridCell[]): Evidence[] {
  const times = new Map<CameraId, Set<number>>();
  for (const c of cells) {
    if (!overlaps(sliceWindow(c.t), claim.window)) continue;
    if (!times.has(c.camera)) times.set(c.camera, new Set());
    times.get(c.camera)!.add(c.t);
  }
  const out: Evidence[] = [];
  for (const camera of CAMERA_IDS) {
    const ts = [...(times.get(camera) ?? [])].sort((a, b) => a - b);
    for (const run of runs(ts.map((t) => ({ t, usable: false })))) {
      const window = runWindow(run);
      out.push({ camera, window, visible: 0, supports: null, contradicts: null, clipId: clipRef(claim.sceneId, camera, window), source: "initial" });
    }
  }
  return out;
}

export function evidenceFor(claim: Claim, rows: GridRow[], questions: Question[]): Evidence[] {
  const { cells } = indexGrid(rows, claim.sceneId);
  const qById = indexQuestions(questions);

  const byEntity = new Map<string, Question[]>();
  for (const q of qById.values()) {
    if (!byEntity.has(q.entityId)) byEntity.set(q.entityId, []);
    byEntity.get(q.entityId)!.push(q);
  }
  const entity = groundEntity(claim, byEntity);
  const prop = entity === null ? null : groundProposition(claim, byEntity.get(entity)!);
  if (prop === null) return ungrounded(claim, cells);

  const claimedId = prop.question.id;
  const altIds = new Set(prop.alternatives.map((q) => q.id));

  // Index relevant cells: camera -> t -> questionId -> cell.
  const grid = new Map<CameraId, Map<number, Map<string, GridCell>>>();
  for (const c of cells) {
    if (c.questionId !== claimedId && !altIds.has(c.questionId)) continue;
    if (!overlaps(sliceWindow(c.t), claim.window)) continue;
    if (!grid.has(c.camera)) grid.set(c.camera, new Map());
    const byT = grid.get(c.camera)!;
    if (!byT.has(c.t)) byT.set(c.t, new Map());
    byT.get(c.t)!.set(c.questionId, c);
  }

  const out: Evidence[] = [];
  for (const camera of CAMERA_IDS) {
    const byT = grid.get(camera);
    if (!byT) continue;
    const slices = [...byT.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, qs]): Slice & { usable: boolean } => {
        const claimed = qs.get(claimedId);
        const alts = [...qs.values()].filter((c) => c.questionId !== claimedId);
        const visible = Math.min(...[...qs.values()].map((c) => c.pVisible));
        const maxAlt = alts.length > 0 ? Math.max(...alts.map((c) => c.pYes)) : null;
        const support = claimed ? (maxAlt === null ? claimed.pYes : Math.min(claimed.pYes, 1 - maxAlt)) : null;
        const contradiction = maxAlt === null ? null : claimed ? Math.min(maxAlt, 1 - claimed.pYes) : maxAlt;
        return { t, visible, support, contradiction, usable: visible >= THRESHOLDS.USABLE };
      });

    for (const run of runs(slices)) {
      const window = runWindow(run);
      const usable = run[0]!.usable;
      out.push({
        camera,
        window,
        visible: Math.min(...run.map((s) => s.visible)),
        supports: usable ? sustainedSupport(run) : null,
        contradicts: usable ? throughoutContradiction(run, claim, window) : null,
        clipId: clipRef(claim.sceneId, camera, window),
        source: "initial",
      });
    }
  }
  return out;
}
