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
