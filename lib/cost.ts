// OWNER: Dev 3. Reads logs/costs.jsonl and enforces LIMITS.BUDGET_HARD_STOP_USD.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { COST_LOG, LIMITS } from "@/lib/config";
import type { CostRecord } from "@/lib/types";

export interface CostStatus {
  spentUsd: number;
  hardStopUsd: number;
  blocked: boolean;
}

export class BudgetExceededError extends Error {
  override name = "BudgetExceededError";
  constructor(readonly status: CostStatus) {
    super(`Budget hard stop reached: $${status.spentUsd.toFixed(4)} spent of $${status.hardStopUsd}.`);
  }
}

/**
 * Only usd is required: a row with a valid cost but other fields missing still counts, so a partly
 * malformed log never undercounts spend. Negative or non-numeric usd is malformed.
 */
const CostRowSchema = z.looseObject({ usd: z.number().finite().nonnegative() });

/** Sums usd from the JSONL cost log. A missing log is $0; malformed lines are skipped with one warning. */
export async function costStatus(logPath: string = COST_LOG): Promise<CostStatus> {
  const file = path.resolve(logPath); // COST_LOG is relative to the repo root; pin it to cwd once, here
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    text = "";
  }

  let spentUsd = 0;
  const bad: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      bad.push(i + 1);
      return;
    }
    const parsed = CostRowSchema.safeParse(row);
    if (parsed.success) spentUsd += parsed.data.usd;
    else bad.push(i + 1);
  });

  if (bad.length) {
    const shown = bad.slice(0, 10).join(", ") + (bad.length > 10 ? ", ..." : "");
    console.warn(`[cost] Skipped ${bad.length} malformed line(s) in ${file}: lines ${shown}.`);
  }

  const hardStopUsd = LIMITS.BUDGET_HARD_STOP_USD;
  return { spentUsd, hardStopUsd, blocked: spentUsd >= hardStopUsd };
}

/** Appends one CostRecord to the JSONL cost log (COST_LOG by default), creating the folder if needed. */
export async function recordCost(record: CostRecord, logPath: string = COST_LOG): Promise<void> {
  const file = path.resolve(logPath);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

/** Throws BudgetExceededError once spend has reached the hard stop. Call before starting an agent run. */
export async function assertBudget(logPath: string = COST_LOG): Promise<void> {
  const status = await costStatus(logPath);
  if (status.blocked) throw new BudgetExceededError(status);
}
