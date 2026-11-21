// OWNER: Dev 3. Tests for the cost meter. Each test writes its own temp cost log.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/config";
import type { CostRecord } from "@/lib/types";
import { assertBudget, BudgetExceededError, costStatus, recordCost } from "@/lib/cost";

let dir: string;
let log: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rashomon-cost-"));
  log = path.join(dir, "costs.jsonl");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const rec = (usd: number, extra: Partial<CostRecord> = {}): CostRecord => ({
  at: "2026-11-21T15:00:00.000Z",
  model: "gemini-4-hydrogen",
  purpose: "scout",
  inputTokens: 100,
  outputTokens: 10,
  usd,
  ...extra,
});

const jsonl = (...rows: unknown[]) => rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";

describe("costStatus", () => {
  it("treats a missing log as $0", async () => {
    expect(await costStatus(path.join(dir, "nope.jsonl"))).toEqual({
      spentUsd: 0,
      hardStopUsd: LIMITS.BUDGET_HARD_STOP_USD,
      blocked: false,
    });
  });

  it("treats an empty log as $0", async () => {
    await writeFile(log, "");
    expect((await costStatus(log)).spentUsd).toBe(0);
  });

  it("sums usd across records", async () => {
    await writeFile(log, jsonl(rec(0.25), rec(1.5), rec(0.125, { sceneId: "s1" })));
    expect(await costStatus(log)).toEqual({
      spentUsd: 1.875,
      hardStopUsd: LIMITS.BUDGET_HARD_STOP_USD,
      blocked: false,
    });
  });

  it("skips malformed lines with one warning instead of crashing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(
      log,
      jsonl(rec(1), "{not json", { usd: "2" }, { usd: -5 }, { usd: null }, [1], rec(0.5), "", "   "),
    );
    expect((await costStatus(log)).spentUsd).toBe(1.5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/5 malformed.*lines 2, 3, 4, 5, 6/);
  });

  it("counts records with only a valid usd, so partial logs never undercount", async () => {
    await writeFile(log, jsonl({ usd: 0.75 }, rec(0.25)));
    expect((await costStatus(log)).spentUsd).toBe(1);
  });

  it("resolves a relative log path against the working directory", async () => {
    await writeFile(log, jsonl(rec(0.5)));
    expect((await costStatus(path.relative(process.cwd(), log))).spentUsd).toBe(0.5);
  });

  it("handles a log without a trailing newline", async () => {
    await writeFile(log, JSON.stringify(rec(0.5)) + "\n" + JSON.stringify(rec(0.5)));
    expect((await costStatus(log)).spentUsd).toBe(1);
  });

  it("is blocked at exactly the hard stop", async () => {
    await writeFile(log, jsonl(rec(LIMITS.BUDGET_HARD_STOP_USD)));
    expect((await costStatus(log)).blocked).toBe(true);
  });

  it("is not blocked just under the hard stop", async () => {
    await writeFile(log, jsonl(rec(LIMITS.BUDGET_HARD_STOP_USD - 0.01)));
    expect((await costStatus(log)).blocked).toBe(false);
  });
});

describe("recordCost", () => {
  it("creates the log folder, appends one line per record, and costStatus() sums them", async () => {
    const nested = path.join(dir, "logs", "costs.jsonl");
    await recordCost(rec(0.25, { cachedTokens: 40 }), nested);
    await recordCost(rec(0.5), nested);
    const lines = (await readFile(nested, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as CostRecord);
    expect(lines).toEqual([rec(0.25, { cachedTokens: 40 }), rec(0.5)]);
    expect((await costStatus(nested)).spentUsd).toBe(0.75);
  });
});

describe("assertBudget", () => {
  it("passes under the hard stop and with no log", async () => {
    await expect(assertBudget(path.join(dir, "nope.jsonl"))).resolves.toBeUndefined();
    await writeFile(log, jsonl(rec(1)));
    await expect(assertBudget(log)).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError once spent reaches the hard stop", async () => {
    await writeFile(log, jsonl(rec(LIMITS.BUDGET_HARD_STOP_USD / 2), rec(LIMITS.BUDGET_HARD_STOP_USD / 2)));
    await expect(assertBudget(log)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(assertBudget(log)).rejects.toThrow(/budget/i);
  });

  it("throws above the hard stop and the error carries the status", async () => {
    await writeFile(log, jsonl(rec(LIMITS.BUDGET_HARD_STOP_USD + 1)));
    const err = await assertBudget(log).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).status.spentUsd).toBe(LIMITS.BUDGET_HARD_STOP_USD + 1);
  });
});
