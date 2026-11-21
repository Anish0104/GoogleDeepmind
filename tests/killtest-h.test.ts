// OWNER: Dev 3. Kill test H, offline mode only (no Gemini, no video): the same function `pnpm killtest h` runs.
import { beforeAll, describe, expect, it } from "vitest";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import { buildScene, CASES, CLAIMS, formatReport, runKillTestH, type HReport } from "@/scripts/killtests/h";

// Whole kill-test runs are slow-ish under the parallel suite; give them room instead of the 5 s default.
describe("kill test H (offline: safety checks only)", { timeout: 60_000 }, () => {
  let report: HReport;
  beforeAll(async () => {
    report = await runKillTestH("offline");
  }, 60_000);

  it("passes: 0 right labels changed, 0 new Contradicted, at least 3 of 5 wrong labels downgraded", () => {
    const r = report;
    expect(r.label).toBe("H offline: safety checks only");
    expect(r.rightChanged).toBe(0);
    expect(r.newContradicted).toBe(0);
    expect(r.wrongTotal).toBe(5);
    expect(r.wrongDowngraded).toBeGreaterThanOrEqual(3);
    expect(r.pass).toBe(true);
    expect(r.rows.map((x) => [x.claimId, x.initial])).toEqual(CASES.map((c) => [c.id, c.initial]));
    for (const row of r.rows) expect(row.steps).toMatch(/inspect/);
  });

  it("the scene is as specified: 10 decided Skeptic-eligible claims, 5 right and 5 wrong, built deterministically", () => {
    const a = buildScene(); // throws if any claim isn't decided as designed or isn't Skeptic-eligible
    const b = buildScene();
    expect(a.stillsRows).toEqual(b.stillsRows);
    expect(a.clipRows).toEqual(b.clipRows);
    expect(CLAIMS).toHaveLength(10);
    expect(CASES.filter((c) => c.kind === "right")).toHaveLength(5);
    expect([...a.initial.values()].every((r) => r.verdict !== "Insufficient")).toBe(true);
    // In 3 of the 5 wrong claims only one included camera can see the truth in a clip.
    expect(CASES.filter((c) => c.kind === "wrong" && c.clipsBlocked.length === 2).map((c) => c.id)).toEqual(["w2", "w3", "w5"]);
  });

  it("runs are reproducible", async () => {
    expect(await runKillTestH("offline")).toEqual(report);
  });

  it("picking the right camera matters: checking cameras alphabetically misses w2 (only C sees the truth)", async () => {
    const alphabetical = async ({ menu }: TurnInput): Promise<TurnOutput> => {
      const done = new Set(menu.alreadyChecked.map((k) => k.camera));
      const next = menu.includedCameras.filter((c) => !done.has(c)).sort()[0];
      const [w0, w1] = menu.claim.window;
      return next
        ? { name: "inspect_window", args: { camera_id: next, start_s: w0, end_s: w1, crop: "entity", reason: "next camera" }, tokens: 0, costUsd: 0, latencyMs: 0 }
        : { name: "stop", args: { reason: "done" }, tokens: 0, costUsd: 0, latencyMs: 0 };
    };
    const r = await runKillTestH("offline", alphabetical);
    expect(r.rows.find((x) => x.claimId === "w2")).toMatchObject({ initial: "Contradicted", final: "Contradicted", steps: "inspect A, inspect B, stop" });
    expect(r.rightChanged).toBe(0); // still safe, just less useful
    expect(r.newContradicted).toBe(0);
  });

  it("formats the report with the counts, PASS/FAIL and one line per claim", () => {
    const text = formatReport(report);
    expect(text).toMatch(/^H offline: safety checks only/);
    expect(text).toMatch(/right labels changed:\s+0 \(must be 0\)/);
    expect(text).toMatch(/new Contradicted:\s+0 \(must be 0\)/);
    expect(text).toMatch(/wrong labels downgraded: \d of 5 \(need >= 3\)/);
    expect(text).toMatch(/\nPASS\n/);
    expect(text.split("\n").filter((l) => /^(r|w)\d /.test(l))).toHaveLength(10);
    expect(text).not.toMatch(/tokens:/); // only shown in model mode
  });
});
