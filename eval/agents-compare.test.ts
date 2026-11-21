// OWNER: Dev 3. Tests for eval/agents-compare.ts across Investigator (off/fixed/standin/managed) and Skeptic (off/on).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSyntheticComparisonCases,
  compareAgents,
  fixedNextWindowTurn,
  formatComparisonMarkdown,
  runAgentComparison,
} from "@/eval/agents-compare";

describe("eval/agents-compare", { timeout: 60_000 }, () => {
  it("runs all 8 (Investigator: off/fixed/standin/managed x Skeptic: off/on) cells at the 2-check cap", async () => {
    const cases = buildSyntheticComparisonCases();
    expect(cases).toHaveLength(13); // 3 Investigator cases + 10 Skeptic cases

    const report = await runAgentComparison(cases, {
      investigators: ["off", "fixed", "standin", "managed"],
      skeptics: ["off", "on"],
      // Use deterministic fake turns for standin/managed so the test makes zero network calls.
      modelTurn: (mode) => async (input) => {
        const out = await fixedNextWindowTurn(input);
        return {
          ...out,
          tokens: mode === "managed" ? 250 : 120,
          costUsd: mode === "managed" ? 0.002 : 0.0005,
        };
      },
      assertBudget: async () => {},
      now: () => new Date("2026-11-21T20:00:00.000Z"),
      split: "dev",
    });

    expect(report.cells).toHaveLength(8);

    const cell = (inv: string, sk: string) =>
      report.cells.find((c) => c.investigator === inv && c.skeptic === sk)!;

    const baseline = cell("off", "off");
    const invOnly = cell("fixed", "off");
    const skOnly = cell("off", "on");
    const bothManaged = cell("managed", "on");

    // Baseline (off/off): zero checks, zero tokens, undecided claims unresolved, false contradictions remain.
    expect(baseline.checksUsed).toBe(0);
    expect(baseline.undecidedResolvedRight.count).toBe(0);
    expect(baseline.falseContradiction.count).toBeGreaterThan(0);

    // Turning Investigator on resolves recoverable undecided claims without adding wrong decisive labels.
    expect(invOnly.undecidedResolvedRight.count).toBe(2);
    expect(invOnly.wrongDecisiveIntroduced.count).toBe(0);

    // Turning Skeptic on removes >= 3 of 5 wrong decided claims and downgrades 0 right decided claims.
    expect(skOnly.wrongDecidedRemoved.count).toBeGreaterThanOrEqual(3);
    expect(skOnly.rightDecidedDowngraded.count).toBe(0);
    expect(skOnly.falseContradiction.count).toBeLessThan(baseline.falseContradiction.count);

    // Managed + Skeptic tracks tokens & USD and improves accuracy + lowers false-contradiction rate over off/off.
    expect(bothManaged.tokens).toBeGreaterThan(0);
    expect(bothManaged.costUsd).toBeGreaterThan(0);
    expect(bothManaged.accuracy.count).toBeGreaterThan(baseline.accuracy.count);
    expect(bothManaged.falseContradiction.count).toBeLessThan(baseline.falseContradiction.count);

    const md = formatComparisonMarkdown(report);
    expect(md).toMatch(/^# Agent comparison \(dev\)/);
    expect(md).toMatch(/\| managed \| on \|/);
    expect(md).toMatch(/False-contradiction rate/);
  });

  it("compareAgents writes JSON and Markdown comparison artifacts in offline mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rashomon-cmp-"));
    try {
      const report = await compareAgents("dev", { dataDir: dir, offline: true });
      expect(report.cells.map((c) => `${c.investigator}/${c.skeptic}`)).toEqual([
        "off/off",
        "off/on",
        "fixed/off",
        "fixed/on",
      ]);
      const md = await readFile(path.join(dir, "eval", "results", "agents-compare-dev.md"), "utf8");
      const json = JSON.parse(await readFile(path.join(dir, "eval", "results", "agents-compare-dev.json"), "utf8"));
      expect(md).toContain("| fixed | on |");
      expect(json.casesCount).toBe(13);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
