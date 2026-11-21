// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { loadScene } from "@/components/loadScene";
import { exampleFor, hudFrame } from "./hud";

describe("hudFrame", () => {
  it("types, fills bars after 40 ticks, stamps after 70, then moves to the next claim", () => {
    expect(hudFrame(0, 4)).toEqual({ index: 0, chars: 0, bars: false, stamped: false });
    expect(hudFrame(50, 4)).toEqual({ index: 0, chars: 70, bars: true, stamped: false });
    expect(hudFrame(100, 4).stamped).toBe(true);
    expect(hudFrame(125, 4).index).toBe(1);
    expect(hudFrame(125 * 4, 4).index).toBe(0);
    expect(hudFrame(10, 0).index).toBe(0);
  });
});

describe("exampleFor", () => {
  it("picks the first demo claim whose first label matches", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(exampleFor("Supported", s.claims, s.results)?.claim).toBe("I moved the red mug to the shelf.");
    expect(exampleFor("Contradicted", s.claims, s.results)?.claim).toBe("I put the keys in the drawer.");
    expect(exampleFor("Insufficient", s.claims, s.results)?.claim).toBe("I opened the blue box.");
    expect(exampleFor("Supported", [], [])).toBeNull();
  });
});
