// OWNER: Dev 3. Builds the eval accounts for one warehouse scene from its answer key (pure, deterministic).
// Two accounts per scene: "true" (every statement true) and "mixed" (2 statements flipped to false).
//
// Statements (first person, the worker), each with a true and a false wording:
//   contact  "The forklift hit me." / "It never touched me."                      truth: outcome
//   dodge    "I got out of the way before it reached me." (/ "I didn't …")         dodgeStartT < minGapT
//   stop     "The forklift stopped before it reached me." (/ "… didn't stop …")    forkliftStopT < minGapT
//   moving   "It kept moving the whole time." / "It stopped at some point."       forkliftStopT == null
//   time     "It hit me about N seconds in." (contact, N = round(contact[0])) or
//            "It came closest about N seconds in." (near miss, N = round(minGapT)); false: N shifted by >= 3 s
// moment: contact window (or minGapT) +/- 1 s, clamped to the clip; "moving" uses the whole clip.
// expected: Insufficient if no included camera sees the worker in any slice covering the moment, else
//   Supported for a true statement and Contradicted for a false one.
// A statement whose field is absent from the answer key is skipped (a missing forkliftStopT counts as null).
import type { CameraId, SceneManifest, Verdict } from "@/lib/types";
import type { Truth } from "@/scripts/eval/truth";

export type StatementKind = "contact" | "dodge" | "stop" | "moving" | "time";
export const KINDS: readonly StatementKind[] = ["contact", "dodge", "stop", "moving", "time"];
export const SEED = 119;
const SLICE_S = 0.5;

export interface Statement {
  kind: StatementKind;
  text: string;
  truth: boolean;
  moment: [number, number];
  expected: Verdict;
}

export interface EvalAccount {
  name: "true" | "mixed";
  transcript: string;
  statements: Statement[];
  /** Kinds whose false wording was used (mixed only). */
  flipped: StatementKind[];
}

export interface EvalCase {
  sceneId: string;
  seed: number;
  includedCameras: CameraId[];
  /** Kinds left out because the answer key lacks a field they need. */
  skipped: { kind: StatementKind; reason: string }[];
  accounts: EvalAccount[];
}

interface Variants {
  kind: StatementKind;
  trueText: string;
  falseText?: string;
  moment: [number, number];
}

/** Deterministic 32-bit hash (FNV-1a) and PRNG (mulberry32): same scene + seed -> same accounts. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ms = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (w: [number, number], d: number): [number, number] => [ms(Math.max(0, w[0])), ms(Math.min(d, w[1]))];

/** The slices covering [a, b] (a slice covers [t, t + 0.5)). */
const covering = (truth: Truth, [a, b]: [number, number]) => truth.slices.filter((s) => s.t < b && a < s.t + SLICE_S);

/** True if any included camera sees the worker ("yes") in any slice covering the moment. */
export function workerVisible(truth: Truth, moment: [number, number], included: CameraId[]): boolean {
  return covering(truth, moment).some((s) => included.some((c) => s.cameras[c]?.["worker:visible:yes"] === "yes"));
}

function variants(truth: Truth, next: () => number): { list: Variants[]; skipped: EvalCase["skipped"] } {
  const s = truth.summary;
  const d = s.durationS;
  const skipped: EvalCase["skipped"] = [];
  const list: Variants[] = [];
  const hit = s.outcome === "contact";
  const stopT = s.forkliftStopT ?? null; // missing = never stopped

  // The moment around the collision / closest approach.
  let moment: [number, number] | null = null;
  if (hit && s.contact) moment = clamp([s.contact[0] - 1, s.contact[1] + 1], d);
  else if (s.minGapT !== undefined) moment = clamp([s.minGapT - 1, s.minGapT + 1], d);

  const skip = (kind: StatementKind, field: string) => skipped.push({ kind, reason: `answer key has no ${field}` });

  if (moment) {
    list.push({ kind: "contact", trueText: hit ? "The forklift hit me." : "It never touched me.", falseText: hit ? "It never touched me." : "The forklift hit me.", moment });
  } else skip("contact", hit ? "summary.contact or summary.minGapT" : "summary.minGapT");

  if (moment && s.minGapT !== undefined && s.dodgeStartT !== undefined) {
    const dodged = s.dodgeStartT !== null && s.dodgeStartT < s.minGapT;
    const pos = "I got out of the way before it reached me.";
    const neg = "I didn't get out of the way before it reached me.";
    list.push({ kind: "dodge", trueText: dodged ? pos : neg, falseText: dodged ? neg : pos, moment });
  } else skip("dodge", s.dodgeStartT === undefined ? "summary.dodgeStartT" : "summary.minGapT");

  if (moment && s.minGapT !== undefined) {
    const stopped = stopT !== null && stopT < s.minGapT;
    const pos = "The forklift stopped before it reached me.";
    const neg = "The forklift didn't stop before it reached me.";
    list.push({ kind: "stop", trueText: stopped ? pos : neg, falseText: stopped ? neg : pos, moment });
  } else skip("stop", "summary.minGapT");

  const kept = stopT === null;
  list.push({
    kind: "moving",
    trueText: kept ? "It kept moving the whole time." : "It stopped at some point.",
    falseText: kept ? "It stopped at some point." : "It kept moving the whole time.",
    moment: [0, d],
  });

  const n = hit ? (s.contact ? Math.round(s.contact[0]) : null) : s.minGapT !== undefined ? Math.round(s.minGapT) : null;
  if (moment && n !== null) {
    const say = (k: number) => (hit ? `It hit me about ${k} seconds in.` : `It came closest about ${k} seconds in.`);
    const shifts: number[] = [];
    for (let k = 0; k <= Math.floor(d); k++) if (Math.abs(k - n) >= 3) shifts.push(k);
    const falseN = shifts.length ? shifts[Math.floor(next() * shifts.length)]! : undefined;
    list.push({ kind: "time", trueText: say(n), ...(falseN !== undefined ? { falseText: say(falseN) } : {}), moment });
  } else skip("time", hit ? "summary.contact" : "summary.minGapT");

  return { list, skipped };
}

const statement = (truth: Truth, v: Variants, useFalse: boolean, included: CameraId[]): Statement => {
  const isTrue = !useFalse;
  const visible = workerVisible(truth, v.moment, included);
  return {
    kind: v.kind,
    text: useFalse ? v.falseText! : v.trueText,
    truth: isTrue,
    moment: v.moment,
    expected: !visible ? "Insufficient" : isTrue ? "Supported" : "Contradicted",
  };
};

/** The statements joined as plain first-person speech. */
export const transcriptOf = (statements: Statement[]) => statements.map((s) => s.text).join(" ");

/** Both eval accounts for one scene. Deterministic for a given answer key, manifest and seed. */
export function buildCase(truth: Truth, manifest: Pick<SceneManifest, "cameras" | "excludedCameras">, seed: number = SEED): EvalCase {
  const included = manifest.cameras.filter((c) => !manifest.excludedCameras.includes(c));
  const next = rng(hash(`${truth.sceneId}:${seed}`));
  const { list, skipped } = variants(truth, next);

  // Mixed: flip 2 statements that have a false wording, chosen by the seeded PRNG.
  const flippable = list.filter((v) => v.falseText !== undefined).map((v) => v.kind);
  const flipped: StatementKind[] = [];
  const pool = [...flippable];
  while (flipped.length < 2 && pool.length) flipped.push(pool.splice(Math.floor(next() * pool.length), 1)[0]!);

  const account = (name: EvalAccount["name"], flip: StatementKind[]): EvalAccount => {
    const statements = list.map((v) => statement(truth, v, flip.includes(v.kind), included));
    return { name, transcript: transcriptOf(statements), statements, flipped: KINDS.filter((k) => flip.includes(k)) };
  };
  return { sceneId: truth.sceneId, seed, includedCameras: included, skipped, accounts: [account("true", []), account("mixed", flipped)] };
}
