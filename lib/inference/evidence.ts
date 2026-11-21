// OWNER: Dev 2. Evidence per camera. Only usable views (visibility >= THRESHOLDS.USABLE) count.
// Never average cameras together.
import type { Claim, Evidence, GridRow, Question } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export function evidenceFor(_claim: Claim, _rows: GridRow[], _questions: Question[]): Evidence[] {
  return notImplemented("Dev 2", "evidenceFor");
}
