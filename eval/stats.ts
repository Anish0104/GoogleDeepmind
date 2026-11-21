// OWNER: Dev 4. Wilson intervals and the metrics the report is built from.
// One sample per claim; group with byOcclusion / byScene before reporting.
import type { Verdict } from "@/lib/types";

export interface Rate {
  count: number;
  total: number;
  rate: number;
  low: number; // 95% Wilson interval
  high: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Wilson score interval for a binomial proportion. z=1.96 is ~95%. */
export function wilson(count: number, total: number, z = 1.96): Rate {
  if (total <= 0) return { count: 0, total: 0, rate: 0, low: 0, high: 0 };
  const p = count / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  // The interval must bracket its own point estimate; min/max absorbs ulp-level fp noise
  // (e.g. a high of 0.9999999999999999 at k === total).
  return {
    count,
    total,
    rate: p,
    low: Math.min(clamp01(center - margin), p),
    high: Math.max(clamp01(center + margin), p),
  };
}

export type TruthLabel = Verdict | "Ambiguous";

/** One claim's predicted label vs ground truth, with the occlusion split it belongs to. */
export interface ClaimEval {
  sceneId: string;
  claimId: string;
  predicted: Verdict;
  truth: TruthLabel;
  plannedOcclusion?: boolean;
}

const isDecided = (i: ClaimEval) => i.truth !== "Ambiguous";

/** Build a Rate from a denominator predicate and a numerator predicate. */
function rateWhere(
  items: ClaimEval[],
  inDenominator: (i: ClaimEval) => boolean,
  inNumerator: (i: ClaimEval) => boolean,
): Rate {
  const denom = items.filter(inDenominator);
  const count = denom.filter(inNumerator).length;
  return wilson(count, denom.length);
}

/** Fraction of decided claims whose predicted label matches ground truth. */
export function claimAccuracy(items: ClaimEval[]): Rate {
  return rateWhere(items, isDecided, (i) => i.predicted === i.truth);
}

/**
 * The safety number: among claims that are actually true or unseeable
 * (truth Supported or Insufficient), the fraction wrongly called Contradicted.
 */
export function falseContradictionRate(items: ClaimEval[]): Rate {
  return rateWhere(
    items,
    (i) => isDecided(i) && i.truth !== "Contradicted",
    (i) => i.predicted === "Contradicted",
  );
}

/** Among genuinely false claims (truth Contradicted), the fraction caught. */
export function falseClaimRecall(items: ClaimEval[]): Rate {
  return rateWhere(
    items,
    (i) => i.truth === "Contradicted",
    (i) => i.predicted === "Contradicted",
  );
}

/** Fraction of two-labeler pairs that agree. Disagreements are what become Ambiguous. */
export function labelerAgreement(pairs: { a: TruthLabel; b: TruthLabel }[]): Rate {
  const count = pairs.filter((p) => p.a === p.b).length;
  return wilson(count, pairs.length);
}

/** Split claims by whether their scene had a planned occlusion (reported separately). */
export function byOcclusion(items: ClaimEval[]): { natural: ClaimEval[]; planned: ClaimEval[] } {
  return {
    natural: items.filter((i) => !i.plannedOcclusion),
    planned: items.filter((i) => i.plannedOcclusion),
  };
}
