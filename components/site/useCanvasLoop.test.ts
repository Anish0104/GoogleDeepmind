// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { fakeCtx } from "@/components/canvas/fakeCtx";
import { fitCanvas } from "./useCanvasLoop";

function el(w: number, h: number) {
  const f = fakeCtx();
  return { clientWidth: w, clientHeight: h, width: 0, height: 0, getContext: () => f.ctx, calls: f.calls };
}

describe("fitCanvas", () => {
  it("sizes the backing store for the pixel ratio, capped at 2", () => {
    const c = el(300, 150);
    const r = fitCanvas(c, 3);
    expect(c.width).toBe(600);
    expect(c.height).toBe(300);
    expect(r?.[1]).toBe(300);
    expect(r?.[2]).toBe(150);
    expect(c.calls).toContain("setTransform");
  });

  it("returns null for a missing or hidden canvas", () => {
    expect(fitCanvas(null)).toBeNull();
    expect(fitCanvas(el(0, 100))).toBeNull();
  });
});
