// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { loadScene } from "@/components/loadScene";
import { STAGES, accountText, offsetText, splitClaims, splitTotal, stageProgress } from "./split";

describe("claim split animation", () => {
  it("types claims one after another with a pause between", async () => {
    const { claims } = await loadScene("fixtures/replay/demo-001");
    const total = splitTotal(claims);
    expect(total).toBe(claims.reduce((a, c) => a + c.text.length, 0) + 6 * claims.length);
    expect(splitClaims(claims, 0)).toEqual([]);
    expect(splitClaims(claims, 5)).toEqual([{ id: "c1", text: "I mov", win: "3–7s" }]);
    const done = splitClaims(claims, total);
    expect(done.map((c) => c.text)).toEqual(claims.map((c) => c.text));
    expect(done[2]!.win).toBe("0–22s · approx");
    expect(accountText(claims)).toMatch(/^I moved the red mug to the shelf\. I put the keys/);
  });
});

describe("pipeline + sync", () => {
  it("fills six stages in order", () => {
    expect(STAGES).toHaveLength(6);
    expect(stageProgress(0, 0)).toBe(0);
    expect(stageProgress(1.5, 0)).toBe(1);
    expect(stageProgress(1.5, 1)).toBe(0.5);
    expect(stageProgress(1.5, 2)).toBe(0);
  });

  it("formats offsets while syncing", () => {
    expect(offsetText(0.412, 0)).toBe("—");
    expect(offsetText(0.412, 0.5)).toBe("+0.206s");
    expect(offsetText(-0.236, 1)).toBe("-0.236s");
  });
});
