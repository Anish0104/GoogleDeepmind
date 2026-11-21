// OWNER: Dev 4. The script generator must be deterministic (reproducible benchmark),
// stay within the action/occlusion spec, and only ever produce ground-truth scripts.
import { describe, expect, it } from "vitest";
import { ZONES } from "@/lib/config";
import {
  ACTIONS,
  CAMERAS,
  OBJECTS,
  OBJECTS_FOR,
  generateScript,
  type SceneScript,
} from "./scriptgen";

describe("generateScript", () => {
  it("is deterministic for a given seed", () => {
    const a = generateScript("scene-001", 42);
    const b = generateScript("scene-001", 42);
    expect(a).toEqual(b);
  });

  it("derives a stable seed from the sceneId when none is given", () => {
    expect(generateScript("scene-007")).toEqual(generateScript("scene-007"));
  });

  it("different seeds usually produce different scripts", () => {
    const scripts = Array.from({ length: 20 }, (_, i) => generateScript("s", i));
    const signatures = new Set(scripts.map((s) => JSON.stringify(s.actions)));
    expect(signatures.size).toBeGreaterThan(10);
  });

  it("picks 3 to 6 actions, each a known action on a known object", () => {
    for (let seed = 0; seed < 100; seed++) {
      const s = generateScript("s", seed);
      expect(s.actions.length).toBeGreaterThanOrEqual(3);
      expect(s.actions.length).toBeLessThanOrEqual(6);
      for (const a of s.actions) {
        expect(ACTIONS).toContain(a.action);
        expect(OBJECTS).toContain(a.object);
        if (a.toZone !== undefined) expect(ZONES).toContain(a.toZone);
      }
    }
  });

  it("only pairs actions with objects they can actually be performed on", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const a of generateScript("s", seed).actions) {
        expect(OBJECTS_FOR[a.action]).toContain(a.object);
      }
    }
  });

  it("every plausibility pool is a non-empty subset of OBJECTS", () => {
    for (const action of ACTIONS) {
      const pool = OBJECTS_FOR[action];
      expect(pool.length).toBeGreaterThan(0);
      for (const obj of pool) expect(OBJECTS).toContain(obj);
    }
  });

  it("plans an occlusion on roughly a third of scenes", () => {
    const N = 600;
    const occluded = Array.from({ length: N }, (_, i) => generateScript("s", i)).filter(
      (s) => s.plannedOcclusion !== null,
    ).length;
    const rate = occluded / N;
    expect(rate).toBeGreaterThan(0.25);
    expect(rate).toBeLessThan(0.42);
  });

  it("keeps any occlusion in-bounds: real camera, valid action index", () => {
    for (let seed = 0; seed < 200; seed++) {
      const s: SceneScript = generateScript("s", seed);
      if (!s.plannedOcclusion) continue;
      expect(CAMERAS).toContain(s.plannedOcclusion.camera);
      expect(s.plannedOcclusion.atAction).toBeGreaterThanOrEqual(0);
      expect(s.plannedOcclusion.atAction).toBeLessThan(s.actions.length);
    }
  });

  it("records the sceneId and seed it used", () => {
    const s = generateScript("dev-012", 99);
    expect(s.sceneId).toBe("dev-012");
    expect(s.seed).toBe(99);
  });
});
