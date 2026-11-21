// OWNER: Dev 4. Split resolution reads manifests and returns the scenes in that split.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSplit } from "./run";

async function scene(dataDir: string, id: string, split: string) {
  const dir = path.join(dataDir, "scenes", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ sceneId: id, split }));
}

describe("resolveSplit", () => {
  it("returns only the scenes whose manifest matches the split", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-"));
    await scene(dataDir, "dev-001", "dev");
    await scene(dataDir, "dev-002", "dev");
    await scene(dataDir, "held-001", "heldout");

    const dev = await resolveSplit("dev", dataDir);
    expect(dev.map((s) => s.sceneId).sort()).toEqual(["dev-001", "dev-002"]);
    const held = await resolveSplit("heldout", dataDir);
    expect(held.map((s) => s.sceneId)).toEqual(["held-001"]);
  });

  it("marks a scene scored only when it has results.json", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-"));
    await scene(dataDir, "dev-001", "dev");
    await writeFile(path.join(dataDir, "scenes", "dev-001", "results.json"), "[]");
    await scene(dataDir, "dev-002", "dev");

    const scenes = await resolveSplit("dev", dataDir);
    const byId = Object.fromEntries(scenes.map((s) => [s.sceneId, s.scored]));
    expect(byId["dev-001"]).toBe(true);
    expect(byId["dev-002"]).toBe(false);
  });

  it("returns nothing for an empty data dir", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-"));
    expect(await resolveSplit("dev", dataDir)).toEqual([]);
  });
});
