// OWNER: Dev 1. The one Gemini client every dev calls. Logs a CostRecord per call
// to logs/costs.jsonl and respects LIMITS.MAX_CONCURRENT_CALLS (free tier: keep low).
import type { ZodType } from "zod";
import type { CostRecord } from "@/lib/types";
import { notImplemented } from "@/lib/not-implemented";

export interface CallContext {
  purpose: string; // e.g. "scout", "lattice", "auditor", "judge"
  sceneId?: string;
}

/** Text + image/video parts in, JSON out, parsed with the given zod schema. */
export async function generateJson<T>(
  _model: string,
  _parts: unknown[],
  _schema: ZodType<T>,
  _ctx: CallContext,
): Promise<T> {
  return notImplemented("Dev 1", "generateJson");
}

export interface DecisionQuestion {
  id: string;
  text: string;
  /** "yes/no" questions return one probability; "choice" questions one per option. */
  kind: "noul" | "choice";
  options?: string[];
}

/** Decisions API: scores many yes/no or multiple-choice questions about the same input. */
export async function decide(
  _parts: unknown[],
  _questions: DecisionQuestion[],
  _ctx: CallContext,
): Promise<Record<string, number | Record<string, number>>> {
  return notImplemented("Dev 1", "decide");
}

export function logCost(_record: CostRecord): void {
  notImplemented("Dev 1", "logCost");
}
