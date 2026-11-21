// OWNER: Dev 3. Kill test G offline suite: verifies Investigator recovery, disagreement resolution and unseeable safety.
import { beforeAll, describe, expect, it } from "vitest";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import {
  buildScene,
  CASES,
  CLAIMS,
  formatReport,
  runKillTestG,
  type GReport,
} from "@/scripts/killtests/g";

describe("kill test G (offline: Investigator wiring & recovery)", { timeout: 60_000 }, () => {
  let report: GReport;

  beforeAll(async () => {
    report = await runKillTestG("offline");
  }, 60_000);

  it("passes: resolves recoverable undecided claims, stops cleanly after settling, and keeps unseeable Insufficient", () => {
    expect(report.pass).toBe(true);
    expect(report.recoverableResolved).toBe(report.recoverableTotal);
    expect(report.falseDecisiveOnUnseeable).toBe(0);
    expect(report.allStoppedCleanly).toBe(true);
    expect(report.rows.map((r) => [r.claimId, r.initial, r.final])).toEqual([
      ["g1", "Insufficient", "Supported"],
      ["g2", "Insufficient", "Contradicted"],
      ["g3", "Insufficient", "Insufficient"],
    ]);
  });

  it("builds a deterministic Investigator-eligible scene", () => {
    const a = buildScene();
    const b = buildScene();
    expect(a.stillsRows).toEqual(b.stillsRows);
    expect(a.clipRows).toEqual(b.clipRows);
    expect(CLAIMS).toHaveLength(CASES.length);
    for (const r of a.initial.values()) {
      expect(r.verdict).toBe("Insufficient");
    }
  });

  it("stops early once a single clip settles g1 instead of wasting the second check", () => {
    const g1 = report.rows.find((r) => r.claimId === "g1")!;
    expect(g1.validChecks).toBe(1);
    expect(g1.steps).toMatch(/^inspect [ABC], stop$/);
  });

  it("fails the report if an agent makes only rejected calls and picks 0 valid clips", async () => {
    const badTurn = async (_in: TurnInput): Promise<TurnOutput> => ({
      name: "inspect_window",
      args: { camera_id: "Z" },
      tokens: 0,
      costUsd: 0,
      latencyMs: 0,
    });
    const failed = await runKillTestG("offline", badTurn);
    expect(failed.validClipsPicked).toBe(0);
    expect(failed.allStoppedCleanly).toBe(false);
    expect(failed.pass).toBe(false);
  });

  it("formats a human-readable summary with PASS/FAIL and per-claim transitions", () => {
    const text = formatReport(report);
    expect(text).toMatch(/^G offline: Investigator wiring & recovery check/);
    expect(text).toMatch(/false labels on unseeable:\s+0 \(must be 0\)/);
    expect(text).toMatch(/\nPASS\n/);
    expect(text).toMatch(/g1\s+Insufficient -> Supported/);
    expect(text).toMatch(/g3\s+Insufficient -> Insufficient/);
  });
});
