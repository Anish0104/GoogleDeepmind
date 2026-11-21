// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { HK, RIG, VIEWS, handAt, world } from "./scene";

describe("rig", () => {
  it("has all four cameras with a view description; D is rolled (fell over)", () => {
    expect(Object.keys(RIG)).toEqual(["A", "B", "C", "D"]);
    expect(Object.keys(VIEWS)).toEqual(["A", "B", "C", "D"]);
    expect(RIG.D.roll).toBeCloseTo(1.2);
  });
});

describe("handAt", () => {
  it("hits each keyframe and holds the last one", () => {
    for (const [t, p] of HK) {
      const h = handAt(t);
      h.forEach((v, i) => expect(v).toBeCloseTo(p[i]!));
    }
    expect(handAt(99)).toEqual(HK[HK.length - 1]![1]);
  });
});

describe("world", () => {
  it("moves the mug to the shelf, hides the keys after 12.8 s and occludes the box 15–19 s", () => {
    const mug = (t: number) => world(t).ents.find((e) => e.name === "red mug")!;
    expect(mug(10).p).toEqual([0, 1.3, -2.7]);
    expect(world(12).ents.find((e) => e.name === "keys")!.hidden).toBe(false);
    expect(world(13).ents.find((e) => e.name === "keys")!.hidden).toBe(true);
    expect(world(16).ents.find((e) => e.name === "blue box")!.occl).toBe(true);
    expect(world(20).ents.find((e) => e.name === "blue box")!.occl).toBe(false);
  });
});
