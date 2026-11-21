// OWNER: Dev 1. Kill test A scoring: are the grid's probabilities trustworthy? Joins GridRows to an
// SDG-Warehouse answer key and measures calibration error (ECE), ranking (AUROC) and visibility accuracy.
// Pure functions: no files, no models. The answer key is only ever read here, for scoring.
import type { CameraId, GridRow } from "@/lib/types";
import type { SdgTruthFile } from "@/lib/capture/sdgWarehouse";

export interface Pair {
  p: number;
  y: 0 | 1;
}

export interface Labeled extends Pair {
  sceneId: string;
  camera: CameraId;
  t: number;
  questionId: string;
  kind: "visible" | "state";
}

export const KILL_TEST_A = { MAX_ECE: 0.1, MIN_AUROC: 0.85, MIN_VISIBLE_ACCURACY: 0.9, BINS: 10 } as const;

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface Bin {
  lo: number;
  hi: number;
  n: number;
  meanP: number;
  hitRate: number;
}

/** Equal-width probability bins (p = 1 goes in the top bin); empty bins are left out. */
export function reliability(ps: Pair[], bins: number = KILL_TEST_A.BINS): Bin[] {
  const acc = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const { p, y } of ps) {
    const b = acc[Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))]!;
    b.n++;
    b.p += p;
    b.y += y;
  }
  return acc.flatMap((b, i) =>
    b.n === 0 ? [] : [{ lo: r6(i / bins), hi: r6((i + 1) / bins), n: b.n, meanP: r6(b.p / b.n), hitRate: r6(b.y / b.n) }],
  );
}

/** Expected calibration error: each bin's |mean p - hit rate|, weighted by its share of samples. */
export function ece(ps: Pair[], bins: number = KILL_TEST_A.BINS): number {
  if (ps.length === 0) return NaN;
  return reliability(ps, bins).reduce((s, b) => s + (b.n / ps.length) * Math.abs(b.meanP - b.hitRate), 0);
}

/** Probability that a random positive scores above a random negative (ties count half). NaN with one class. */
export function auroc(ps: Pair[]): number {
  const pos = ps.filter((x) => x.y === 1).map((x) => x.p);
  const neg = ps.filter((x) => x.y === 0).map((x) => x.p);
  if (pos.length === 0 || neg.length === 0) return NaN;
  let won = 0;
  for (const a of pos) for (const b of neg) won += a > b ? 1 : a === b ? 0.5 : 0;
  return won / (pos.length * neg.length);
}

/** Share answered right with a 0.5 threshold. */
export function accuracy(ps: Pair[]): number {
  if (ps.length === 0) return NaN;
  return ps.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.y).length / ps.length;
}

/** What each answer-key question is about: a state question is scored only where the camera sees all of it. */
const NEEDS: Record<string, string[]> = {
  "forklift:state:near_worker": ["worker", "forklift"],
  "forklift:state:touching_worker": ["worker", "forklift"],
  "forklift:state:moving": ["forklift"],
  "worker:state:dodging": ["worker"],
};
const VISIBLE = new Set(["worker:visible:yes", "forklift:visible:yes"]);

/** Labels each grid row the answer key covers; rows it cannot label (unclear, unseen, unknown) are dropped. */
export function joinWithTruth(rows: GridRow[], truth: SdgTruthFile): Labeled[] {
  const out: Labeled[] = [];
  for (const r of rows) {
    if (r.sceneId !== truth.sceneId) continue;
    const slice = truth.slices.find((s) => Math.abs(s.t - r.t) < 1e-6);
    const cam = slice?.cameras[r.camera];
    if (!slice || !cam) continue;
    let answer: unknown;
    let kind: Labeled["kind"];
    if (VISIBLE.has(r.questionId)) {
      answer = cam[r.questionId];
      kind = "visible";
    } else if (NEEDS[r.questionId]) {
      if (!NEEDS[r.questionId]!.every((e) => cam[`${e}:visible:yes`] === "yes")) continue;
      answer = slice.answers[r.questionId];
      kind = "state";
    } else continue;
    if (answer !== "yes" && answer !== "no") continue;
    out.push({ sceneId: r.sceneId, camera: r.camera, t: r.t, questionId: r.questionId, kind, p: r.pYes, y: answer === "yes" ? 1 : 0 });
  }
  return out;
}

export interface QuestionScore {
  questionId: string;
  kind: Labeled["kind"];
  n: number;
  positives: number;
  ece: number;
  auroc: number;
  accuracy: number;
}

export interface KillTestAResult {
  state: { n: number; ece: number; auroc: number; accuracy: number; bins: Bin[] };
  visible: { n: number; accuracy: number; ece: number };
  perQuestion: QuestionScore[];
  pass: boolean;
  failures: string[];
}

export function scoreKillTestA(labeled: Labeled[]): KillTestAResult {
  const state = labeled.filter((l) => l.kind === "state");
  const visible = labeled.filter((l) => l.kind === "visible");
  const s = { n: state.length, ece: ece(state), auroc: auroc(state), accuracy: accuracy(state), bins: reliability(state) };
  const v = { n: visible.length, accuracy: accuracy(visible), ece: ece(visible) };
  const ids = [...new Set(labeled.map((l) => l.questionId))].sort();
  const perQuestion = ids.map((questionId) => {
    const q = labeled.filter((l) => l.questionId === questionId);
    return {
      questionId,
      kind: q[0]!.kind,
      n: q.length,
      positives: q.filter((l) => l.y === 1).length,
      ece: ece(q),
      auroc: auroc(q),
      accuracy: accuracy(q),
    };
  });
  const f = (x: number) => (Number.isNaN(x) ? "n/a" : x.toFixed(3));
  const failures: string[] = [];
  if (s.n === 0) failures.push("no labeled state rows");
  else {
    if (!(s.ece <= KILL_TEST_A.MAX_ECE)) failures.push(`calibration error ${f(s.ece)} > ${KILL_TEST_A.MAX_ECE}`);
    if (!(s.auroc >= KILL_TEST_A.MIN_AUROC)) failures.push(`AUROC ${f(s.auroc)} < ${KILL_TEST_A.MIN_AUROC}`);
  }
  if (v.n === 0) failures.push("no labeled visibility rows");
  else if (!(v.accuracy >= KILL_TEST_A.MIN_VISIBLE_ACCURACY)) {
    failures.push(`visibility ${f(v.accuracy)} right < ${KILL_TEST_A.MIN_VISIBLE_ACCURACY}`);
  }
  return { state: s, visible: v, perQuestion, pass: failures.length === 0, failures };
}

// ---------- calibration (Platt scaling) ----------
// The grid ranks well but is underconfident. A Platt curve p' = sigmoid(a * logit(p) + b), fitted per
// question on scenes with answer keys, rescales confidence without changing the order of answers.

export interface PlattModel {
  a: number;
  b: number;
  /** Samples it was fitted on. */
  n: number;
}

const IDENTITY = (n: number): PlattModel => ({ a: 1, b: 0, n });
const EPS_P = 1e-4;
const logit = (p: number) => {
  const q = Math.min(1 - EPS_P, Math.max(EPS_P, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
/** Fewer samples, or fewer than this many of either answer, and the curve stays the identity. */
export const MIN_PLATT_SAMPLES = 20;
const MIN_PER_CLASS = 5;
/**
 * The less common answer must be at least this share of the data. On lopsided data (the SDG forklift
 * moves in ~96% of slices) a curve mostly learns "usually yes", which would wrongly push a stopped
 * forklift towards "moving" on new footage. Those questions keep the model's own answers.
 */
export const MIN_MINORITY_SHARE = 0.2;

/** Logistic regression of y on logit(p), by Newton's method with a little L2 (keeps it finite). */
export function fitPlatt(ps: Pair[]): PlattModel {
  const pos = ps.filter((x) => x.y === 1).length;
  const minority = Math.min(pos, ps.length - pos);
  if (ps.length < MIN_PLATT_SAMPLES || minority < MIN_PER_CLASS || minority < MIN_MINORITY_SHARE * ps.length) return IDENTITY(ps.length);
  const xs = ps.map((x) => logit(x.p));
  let a = 1;
  let b = 0;
  const lambda = 1e-3;
  for (let it = 0; it < 100; it++) {
    let ga = lambda * (a - 1);
    let gb = 0;
    let haa = lambda;
    let hab = 0;
    let hbb = 1e-9;
    xs.forEach((x, i) => {
      const p = sigmoid(a * x + b);
      const r = p - ps[i]!.y;
      const w = p * (1 - p);
      ga += r * x;
      gb += r;
      haa += w * x * x;
      hab += w * x;
      hbb += w;
    });
    const det = haa * hbb - hab * hab;
    if (!(det > 0)) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 ? { a, b, n: ps.length } : IDENTITY(ps.length);
}

export function applyPlatt(p: number, m: Pick<PlattModel, "a" | "b">): number {
  return sigmoid(m.a * logit(p) + m.b);
}

/** One curve per question id. */
export function fitPerQuestion(labeled: Labeled[]): Record<string, PlattModel> {
  const ids = [...new Set(labeled.map((l) => l.questionId))].sort();
  return Object.fromEntries(ids.map((id) => [id, fitPlatt(labeled.filter((l) => l.questionId === id))]));
}

/** Each scene's answers calibrated with curves fitted on the OTHER scenes: an honest estimate for new footage. */
export function leaveOneSceneOut(labeled: Labeled[]): Labeled[] {
  const scenes = [...new Set(labeled.map((l) => l.sceneId))];
  return scenes.flatMap((s) => {
    const models = fitPerQuestion(labeled.filter((l) => l.sceneId !== s));
    return labeled.filter((l) => l.sceneId === s).map((l) => (models[l.questionId] ? { ...l, p: applyPlatt(l.p, models[l.questionId]!) } : l));
  });
}
