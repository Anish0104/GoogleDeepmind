// OWNER: Dev 3. Reads logs/costs.jsonl and enforces LIMITS.BUDGET_HARD_STOP_USD.
import { notImplemented } from "@/lib/not-implemented";

export interface CostStatus {
  spentUsd: number;
  hardStopUsd: number;
  blocked: boolean;
}

export async function costStatus(): Promise<CostStatus> {
  return notImplemented("Dev 3", "costStatus");
}

/** Throws if starting another agent run would cross the hard stop. */
export async function assertBudget(): Promise<void> {
  notImplemented("Dev 3", "assertBudget");
}
