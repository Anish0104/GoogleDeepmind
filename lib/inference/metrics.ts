// OWNER: Dev 2. Event F1 for kill test C (stateModel vs labelled events).
import type { Event } from "@/lib/types";

export interface EventScore {
  precision: number;
  recall: number;
  f1: number;
  matched: number;
}

/**
 * A predicted event matches a truth event with the same entityId, from and to, and |dt| <= toleranceS.
 * Each event matches at most once; pairs are taken closest-first. Empty predictions have precision 1
 * (nothing claimed wrongly); empty truth has recall 1. F1 is 0 unless something matched, or both are empty.
 */
export function eventF1(predicted: readonly Event[], truth: readonly Event[], toleranceS = 1): EventScore {
  const pairs: { i: number; j: number; dt: number }[] = [];
  predicted.forEach((p, i) =>
    truth.forEach((g, j) => {
      const dt = Math.abs(p.t - g.t);
      if (p.entityId === g.entityId && p.from === g.from && p.to === g.to && dt <= toleranceS + 1e-9)
        pairs.push({ i, j, dt });
    }),
  );
  pairs.sort((a, b) => a.dt - b.dt || a.i - b.i || a.j - b.j);
  const usedP = new Set<number>();
  const usedT = new Set<number>();
  for (const { i, j } of pairs) {
    if (usedP.has(i) || usedT.has(j)) continue;
    usedP.add(i);
    usedT.add(j);
  }
  const matched = usedP.size;
  const precision = predicted.length === 0 ? 1 : matched / predicted.length;
  const recall = truth.length === 0 ? 1 : matched / truth.length;
  const f1 =
    predicted.length === 0 && truth.length === 0
      ? 1
      : precision + recall === 0 || matched === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, matched };
}
