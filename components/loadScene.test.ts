// OWNER: Dev 4. loadScene must read the demo fixture into the shapes the board relies on.
import { describe, expect, it } from "vitest";
import { loadScene } from "./loadScene";

describe("loadScene (demo fixture)", () => {
  it("reads the manifest with the excluded camera", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(s.manifest.sceneId).toBe("demo-001");
    expect(s.manifest.cameras).toEqual(["A", "B", "C", "D"]);
    expect(s.manifest.excludedCameras).toEqual(["D"]);
    expect(s.manifest.plannedOcclusion).toBe(true);
  });

  it("loads one claim result per claim, covering all three verdicts", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(s.claims).toHaveLength(4);
    expect(s.results).toHaveLength(4);
    const verdicts = new Set(s.results.map((r) => r.verdict));
    expect(verdicts).toEqual(new Set(["Supported", "Contradicted", "Insufficient"]));
  });

  it("includes a blocked Skeptic label change (downgrade-only safety)", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    const blocked = s.results
      .flatMap((r) => r.history)
      .find((h) => h.blocked);
    expect(blocked).toBeDefined();
    expect(blocked?.by).toBe("skeptic");
  });

  it("parses grid.jsonl line-by-line", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(s.grid.length).toBeGreaterThan(0);
    for (const row of s.grid) {
      expect(row.sceneId).toBe("demo-001");
      expect(row.pYes).toBeGreaterThanOrEqual(0);
      expect(row.pYes).toBeLessThanOrEqual(1);
    }
  });

  it("sums agent step costs into spentUsd", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(s.agentSteps.length).toBeGreaterThan(0);
    const manual = s.agentSteps.reduce((a, b) => a + b.costUsd, 0);
    expect(s.spentUsd).toBeCloseTo(manual, 2);
    expect(s.spentUsd).toBeLessThan(8); // under the hard stop
  });

  it("returns empty collections for a missing scene instead of throwing", async () => {
    const s = await loadScene("fixtures/replay/does-not-exist");
    expect(s.claims).toEqual([]);
    expect(s.results).toEqual([]);
    expect(s.grid).toEqual([]);
    expect(s.spentUsd).toBe(0);
  });
});
