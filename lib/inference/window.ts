// OWNER: Dev 2. Interval helpers for claim windows and evidence windows (seconds).

/** Gaps smaller than this between adjacent slices are float noise, not missing coverage. */
const SEAM_EPS_S = 1e-6;

function norm([a, b]: readonly [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * True when the two intervals share a span of positive length. Intervals that only touch at an
 * endpoint do not overlap. A zero-length interval is a point and overlaps when it lies inside the other.
 */
export function overlaps(a: readonly [number, number], b: readonly [number, number]): boolean {
  const [a0, a1] = norm(a);
  const [b0, b1] = norm(b);
  if (a0 === a1 || b0 === b1) return a0 <= b1 && b0 <= a1;
  return Math.min(a1, b1) - Math.max(a0, b0) > 0;
}

/** True when the union of `intervals` covers every instant of `target`, with no gaps. */
export function covers(intervals: readonly (readonly [number, number])[], target: readonly [number, number]): boolean {
  const [t0, t1] = norm(target);
  const clipped = intervals
    .map(norm)
    .filter(([a, b]) => b >= t0 && a <= t1)
    .map(([a, b]): [number, number] => [Math.max(a, t0), Math.min(b, t1)])
    .sort((x, y) => x[0] - y[0]);

  if (clipped.length === 0) return false;
  let reached = t0;
  for (const [a, b] of clipped) {
    if (a > reached + SEAM_EPS_S) return false;
    reached = Math.max(reached, b);
    if (reached >= t1 - SEAM_EPS_S) return true;
  }
  return reached >= t1 - SEAM_EPS_S;
}
