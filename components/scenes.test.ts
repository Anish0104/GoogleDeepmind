// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { DEFAULT_SCENE, listScenes, resolveSceneDir } from "./scenes";

describe("listScenes", () => {
  it("finds the bundled demo fixture", async () => {
    expect(await listScenes()).toContain(DEFAULT_SCENE);
  });

  it("returns nothing for a folder without scenes", async () => {
    expect(await listScenes("/nonexistent-root")).toEqual([]);
  });
});

describe("resolveSceneDir", () => {
  it("accepts scene folders under the two roots", () => {
    expect(resolveSceneDir("data/scenes/s-01")).toBe("data/scenes/s-01");
    expect(resolveSceneDir("s-01")).toBe("data/scenes/s-01");
    expect(resolveSceneDir(["fixtures/replay/demo-001/"])).toBe("fixtures/replay/demo-001");
  });

  it("falls back to the demo for anything else", () => {
    expect(resolveSceneDir(undefined)).toBe(DEFAULT_SCENE);
    expect(resolveSceneDir("../../etc")).toBe(DEFAULT_SCENE);
    expect(resolveSceneDir("data/scenes/../../secret")).toBe(DEFAULT_SCENE);
    expect(resolveSceneDir("/etc/passwd")).toBe(DEFAULT_SCENE);
    expect(resolveSceneDir("data/scenes/a/b")).toBe(DEFAULT_SCENE);
  });
});
