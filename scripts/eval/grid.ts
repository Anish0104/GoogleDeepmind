// OWNER: Dev 3. Explains a label: re-grounds the claim exactly as runAccount() does (Dev 2's resolveGrounding on
// the clone's entities/people/questions) and reports the best grid score near the statement's moment for that
// question, over included cameras, against THRESHOLDS.CLEAR. E.g. "touching_worker max 0.47 < 0.8 (cam B at 3 s)".
// Diagnostic only: it never sets or changes a label.
import { LIMITS, THRESHOLDS } from "@/lib/config";
import { resolveGrounding, type SceneRegistry } from "@/lib/truth/grounding";
import type { CameraId, Claim, GridRow } from "@/lib/types";

const short = (questionId: string) => questionId.split(":").slice(2).join(":") || questionId;
const fmt = (x: number) => Number(x.toFixed(2)).toString();

export function gridDetail(claim: Claim, moment: [number, number], rows: GridRow[], included: CameraId[], registry: SceneRegistry): string {
  const g = resolveGrounding(claim, registry);
  if (!g.target) return `ungrounded: ${g.reasons[0] ?? "no reliable grid question"}`;
  const q = g.target.questionId;
  const [m0, m1] = moment;
  const inMoment = rows.filter(
    (r) => r.questionId === q && included.includes(r.camera) && r.t < m1 && m0 < r.t + LIMITS.SLICE_S,
  );
  if (inMoment.length === 0) return `${short(q)}: no grid rows on included cameras in ${fmt(m0)}–${fmt(m1)} s`;
  const best = inMoment.reduce((a, b) => (b.pYes > a.pYes ? b : a));
  const clear = THRESHOLDS.CLEAR;
  return `${short(q)} max ${fmt(best.pYes)} ${best.pYes >= clear ? "≥" : "<"} ${clear} (cam ${best.camera} at ${fmt(best.t)} s)`;
}
