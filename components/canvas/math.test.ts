// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { V, fmt, hash, mkCam, pct, pcol, proj, sstep, winTxt } from "./math";

describe("vector helpers", () => {
  it("adds, subtracts, scales, crosses and normalises", () => {
    expect(V.add([1, 2, 3], [1, 1, 1])).toEqual([2, 3, 4]);
    expect(V.sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(V.scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(V.dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(V.cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(Math.hypot(...V.norm([3, 4, 0]))).toBeCloseTo(1);
    expect(V.norm([0, 0, 0])).toEqual([0, 0, 0]);
    expect(V.lerp([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });
});

describe("sstep", () => {
  it("clamps and eases", () => {
    expect(sstep(0, 1, -1)).toBe(0);
    expect(sstep(0, 1, 2)).toBe(1);
    expect(sstep(0, 1, 0.5)).toBeCloseTo(0.5);
  });
});

describe("mkCam / proj", () => {
  it("projects the target to the screen center and drops points behind the camera", () => {
    const c = mkCam([0, 0, 10], [0, 0, 0]);
    const p = proj(c, [0, 0, 0], 200, 100);
    expect(p?.[0]).toBeCloseTo(100);
    expect(p?.[1]).toBeCloseTo(50);
    expect(p?.[2]).toBeCloseTo(10);
    expect(proj(c, [0, 0, 20], 200, 100)).toBeNull();
  });

  it("honours a horizontal center offset and roll", () => {
    const c = mkCam([0, 0, 10], [0, 0, 0], Math.PI / 2);
    const p = proj(c, [1, 0, 0], 200, 100, 50);
    expect(p?.[0]).toBeCloseTo(50);
    expect(p?.[1]).not.toBeCloseTo(50);
  });
});

describe("hash", () => {
  it("is deterministic and within 0..1", () => {
    expect(hash(1, 2)).toBe(hash(1, 2));
    for (let i = 0; i < 50; i++) {
      const h = hash(i, i * 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe("pcol", () => {
  it("maps 0, 0.5 and 1 to red, amber and green", () => {
    expect(pcol(0, 1)).toBe("rgba(255,90,71,1)");
    expect(pcol(0.5, 1)).toBe("rgba(255,194,61,1)");
    expect(pcol(1, 1)).toBe("rgba(91,228,155,1)");
    expect(pcol(2, "0.5")).toBe("rgba(91,228,155,0.5)");
  });
});

describe("formatting", () => {
  it("formats timecodes, percentages and windows", () => {
    expect(fmt(0)).toBe("00:00.00");
    expect(fmt(65.5)).toBe("01:05.50");
    expect(pct(0.5)).toBe("50.00%");
    expect(pct(3)).toBe("100.00%");
    expect(winTxt([9, 13])).toBe("9–13s");
  });
});
