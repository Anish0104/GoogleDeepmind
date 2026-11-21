// OWNER: Dev 2. Exclusive state pairs (e.g. forklift moving <-> stopped, touching_worker <-> clear_of_worker).
//
// The pairs are Dev 1's: QUESTION_SET_EXCLUSIVE in lib/perception/questionSets.ts (one list of
// [questionId, questionId] per named question set). Dev 2 never defines, infers or restores its own:
// only pairs registered there are used. sdg-nearmiss currently registers none (its opposites
// clear_of_worker and stopped scored high during real contact and motion), so state claims there have no
// alternatives and cannot be contradicted, even on older scenes whose questions.json and grid still
// contain those questions. The mechanism stays generic for question sets that do register pairs.
//
// A registered pair is used for a scene only if both question ids exist in that scene's questions.json, are
// distinct, are both "state" questions and refer to the same entity. Pairs from every named set are pooled
// and filtered by the scene's own questions, so a scene does not need a questionSet field in its manifest.
// Grounding then offers the opposite as the claim's only alternative; evidence still needs the opposite
// seen strongly AND the claimed state low, on a usable camera, throughout the claim window, then a
// decisive independent audit, before verdict() can say Contradicted.
import { z } from "zod";
import { QUESTION_SET_EXCLUSIVE } from "@/lib/perception/questionSets";
import type { Question } from "@/lib/types";

export type ExclusivePair = readonly [string, string];

const PairSchema = z.tuple([z.string().min(1), z.string().min(1)]);
const RegistrySchema = z.record(z.string(), z.array(PairSchema));

/** Every pair Dev 1 registered (all named sets), or [] when none are registered or the export is malformed. */
export function registeredExclusivePairs(): ExclusivePair[] {
  const parsed = RegistrySchema.safeParse(QUESTION_SET_EXCLUSIVE);
  if (!parsed.success) {
    console.warn("[exclusive] QUESTION_SET_EXCLUSIVE is malformed; using no exclusive pairs.");
    return [];
  }
  return Object.values(parsed.data).flat();
}

/** The pairs that are valid for these questions (see header). Malformed input gives []. */
export function validExclusivePairs(pairs: unknown, questions: unknown): ExclusivePair[] {
  const list = z.array(PairSchema).safeParse(pairs);
  if (!list.success || !Array.isArray(questions)) return [];
  const byId = new Map<string, Question>();
  for (const q of questions as Question[]) if (q && typeof q.id === "string") byId.set(q.id, q);
  const out: ExclusivePair[] = [];
  const seen = new Set<string>();
  for (const [a, b] of list.data) {
    const qa = byId.get(a);
    const qb = byId.get(b);
    if (!qa || !qb || a === b) continue;
    if (qa.predicate !== "state" || qb.predicate !== "state" || qa.entityId !== qb.entityId) continue;
    const key = [a, b].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b]);
  }
  return out;
}

/** The registered opposites of one question id, from already-validated pairs. */
export function oppositesOf(questionId: string, pairs: readonly ExclusivePair[]): string[] {
  const out = new Set<string>();
  for (const [a, b] of pairs) {
    if (a === questionId) out.add(b);
    if (b === questionId) out.add(a);
  }
  return [...out];
}
