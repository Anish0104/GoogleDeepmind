// OWNER: Dev 4. The report must lead with the safety metric and split by occlusion.
import { describe, expect, it } from "vitest";
import type { ClaimEval } from "./stats";
import { computeMetrics, formatTable } from "./report";

const items: ClaimEval[] = [
  { sceneId: "s1", claimId: "c1", predicted: "Supported", truth: "Supported", plannedOcclusion: false },
  { sceneId: "s1", claimId: "c2", predicted: "Contradicted", truth: "Contradicted", plannedOcclusion: false },
  { sceneId: "s2", claimId: "c3", predicted: "Contradicted", truth: "Supported", plannedOcclusion: true },
  { sceneId: "s2", claimId: "c4", predicted: "Insufficient", truth: "Insufficient", plannedOcclusion: true },
];

describe("computeMetrics", () => {
  it("lists the false-contradiction rate first", () => {
    expect(computeMetrics(items)[0]?.metric).toMatch(/false-contradiction/i);
  });

  it("gives each metric an overall, natural and planned column", () => {
    const row = computeMetrics(items)[0]!;
    expect(row.overall.total).toBeGreaterThan(0);
    // the one false contradiction is in a planned-occlusion scene
    expect(row.planned.count).toBe(1);
    expect(row.natural.count).toBe(0);
  });

  it("covers accuracy and false-claim recall too", () => {
    const names = computeMetrics(items).map((r) => r.metric.toLowerCase());
    expect(names.some((n) => n.includes("accuracy"))).toBe(true);
    expect(names.some((n) => n.includes("recall"))).toBe(true);
  });
});

describe("formatTable", () => {
  it("renders a non-empty table that names every metric", () => {
    const table = formatTable(computeMetrics(items));
    expect(table).toContain("False-contradiction rate");
    expect(table).toContain("Claim-label accuracy");
    expect(table.split("\n").length).toBeGreaterThan(3);
  });

  it("shows a dash for an empty cell instead of NaN", () => {
    const table = formatTable(computeMetrics([]));
    expect(table).not.toContain("NaN");
    expect(table).toContain("—");
  });
});
