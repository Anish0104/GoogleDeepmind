// OWNER: Dev 3. Tests for the scene store. Each test gets its own temp DATA_DIR.
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ClaimResult } from "@/lib/types";

type Store = typeof import("@/lib/store/scene");

let dataDir: string;
let store: Store;
const prevDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-store-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules(); // DATA_DIR is read when lib/config.ts loads
  store = await import("@/lib/store/scene");
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const sceneFile = (id: string, file: string) => path.join(dataDir, "scenes", id, file);

const input = {
  split: "dev" as const,
  room: "studio",
  cameras: ["A", "B", "C", "D"] as ("A" | "B" | "C" | "D")[],
  excludedCameras: ["D"] as ("A" | "B" | "C" | "D")[],
};

function result(claimId: string, verdict: ClaimResult["verdict"] = "Insufficient"): ClaimResult {
  return { claimId, verdict, evidence: [], audit: null, history: [] };
}

describe("scenePath", () => {
  it("resolves inside DATA_DIR/scenes/<id>/", () => {
    expect(store.scenePath("s1")).toBe(path.resolve(dataDir, "scenes", "s1"));
    expect(store.scenePath("s1", "stills/A.jpg")).toBe(path.resolve(dataDir, "scenes", "s1", "stills", "A.jpg"));
  });

  it("returns an absolute path when DATA_DIR is relative", async () => {
    process.env.DATA_DIR = path.relative(process.cwd(), dataDir);
    vi.resetModules();
    const relStore: Store = await import("@/lib/store/scene");
    const p = relStore.scenePath("s1", "x.json");
    expect(path.isAbsolute(p)).toBe(true);
    expect(p).toBe(path.join(dataDir, "scenes", "s1", "x.json"));
  });

  it.each(["", "..", "../x", "a/b", "a b", ".hidden"])("rejects scene id %j", (id) => {
    expect(() => store.scenePath(id)).toThrow(/scene id/i);
  });

  it.each(["../other/manifest.json", "/etc/passwd", "stills/../../x.json", ""])("rejects file %j", (file) => {
    expect(() => store.scenePath("s1", file)).toThrow(/file/i);
  });
});

describe("createScene", () => {
  it("writes manifest.json with defaults and returns it", async () => {
    const m = await store.createScene(input, { id: "s1", now: new Date("2026-11-21T15:00:00Z") });
    expect(m).toEqual({
      sceneId: "s1",
      split: "dev",
      room: "studio",
      cameras: ["A", "B", "C", "D"],
      excludedCameras: ["D"],
      files: {},
      durationS: 0,
      createdAt: "2026-11-21T15:00:00.000Z",
      plannedOcclusion: false,
    });
    expect(JSON.parse(await readFile(sceneFile("s1", "manifest.json"), "utf8"))).toEqual(m);
  });

  it("accepts plannedOcclusion from scriptgen", async () => {
    const m = await store.createScene({ ...input, plannedOcclusion: true }, { id: "s1" });
    expect(m.plannedOcclusion).toBe(true);
    expect((await store.loadManifest("s1")).plannedOcclusion).toBe(true);
  });

  it("accepts presynced, questionSet and roi, and loadManifest keeps them", async () => {
    const m = await store.createScene({ ...input, presynced: true, questionSet: "warehouse", roi: true }, { id: "s1" });
    expect(m).toMatchObject({ presynced: true, questionSet: "warehouse", roi: true });
    expect(await store.loadManifest("s1")).toMatchObject({ presynced: true, questionSet: "warehouse", roi: true });
  });

  it("leaves the new fields out when not given", async () => {
    const m = await store.createScene(input, { id: "s1" });
    expect(m).not.toHaveProperty("presynced");
    expect(m).not.toHaveProperty("questionSet");
    expect(m).not.toHaveProperty("roi");
  });

  it("rejects an unknown question set, naming the known ones", async () => {
    await expect(store.createScene({ ...input, questionSet: "kitchen" }, { id: "s1" })).rejects.toThrow(
      /Unknown question set "kitchen".*warehouse/,
    );
  });

  it("a hand-written presynced flag in manifest.json survives loadManifest (perceiveScene reads it from there)", async () => {
    await store.createScene(input, { id: "s1" });
    const raw = JSON.parse(await readFile(sceneFile("s1", "manifest.json"), "utf8"));
    await writeFile(sceneFile("s1", "manifest.json"), JSON.stringify({ ...raw, presynced: true }));
    expect((await store.loadManifest("s1")).presynced).toBe(true);
  });

  it("generates a unique, path-safe id by default", async () => {
    const a = await store.createScene(input);
    const b = await store.createScene(input);
    expect(a.sceneId).not.toBe(b.sceneId);
    expect(() => store.scenePath(a.sceneId)).not.toThrow();
  });

  it("refuses to overwrite an existing scene", async () => {
    await store.createScene(input, { id: "s1" });
    await expect(store.createScene(input, { id: "s1" })).rejects.toThrow(/exists/i);
  });

  it("rejects excluded cameras that are not in cameras", async () => {
    await expect(store.createScene({ ...input, cameras: ["A", "B"], excludedCameras: ["C"] })).rejects.toThrow();
  });

  it("rejects no cameras or duplicate cameras", async () => {
    await expect(store.createScene({ ...input, cameras: [], excludedCameras: [] })).rejects.toThrow();
    await expect(store.createScene({ ...input, cameras: ["A", "A"], excludedCameras: [] })).rejects.toThrow();
  });
});

describe("loadManifest", () => {
  it("round-trips a created scene", async () => {
    const m = await store.createScene(input, { id: "s1" });
    expect(await store.loadManifest("s1")).toEqual(m);
  });

  it("throws a clear error for a missing scene", async () => {
    await expect(store.loadManifest("nope")).rejects.toThrow(/nope.*not found/i);
    await expect(store.loadManifest("nope")).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("rejects a corrupt manifest", async () => {
    await mkdir(path.dirname(sceneFile("bad", "manifest.json")), { recursive: true });
    await writeFile(sceneFile("bad", "manifest.json"), JSON.stringify({ sceneId: "bad", split: "nope" }));
    await expect(store.loadManifest("bad")).rejects.toThrow(/manifest/i);
  });
});

describe("writeJson / readJson", () => {
  it("round-trips data and creates folders", async () => {
    await store.writeJson("s1", "views.json", [{ camera: "A", text: "side-on" }]);
    await store.writeJson("s1", "stills/index.json", { A: "a.jpg" });
    expect(await store.readJson("s1", "views.json")).toEqual([{ camera: "A", text: "side-on" }]);
    expect(await store.readJson("s1", "stills/index.json")).toEqual({ A: "a.jpg" });
  });

  it("overwrites and leaves no temp files behind", async () => {
    await store.writeJson("s1", "x.json", { v: 1 });
    await store.writeJson("s1", "x.json", { v: 2 });
    expect(await store.readJson("s1", "x.json")).toEqual({ v: 2 });
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(path.join(dataDir, "scenes", "s1"))).toEqual(["x.json"]);
  });

  it("validates with an optional zod schema", async () => {
    await store.writeJson("s1", "x.json", { v: "one" });
    const schema = z.object({ v: z.number() });
    await expect(store.readJson("s1", "x.json", schema)).rejects.toThrow(/x\.json/);
    await store.writeJson("s1", "x.json", { v: 1, extra: true });
    expect(await store.readJson("s1", "x.json", schema)).toEqual({ v: 1 });
  });

  it("throws a clear error for a missing file", async () => {
    await expect(store.readJson("s1", "missing.json")).rejects.toThrow(/missing\.json.*not found/i);
    await expect(store.readJson("s1", "missing.json")).rejects.toBeInstanceOf(store.NotFoundError);
  });

  it("throws a clear error for invalid JSON", async () => {
    await mkdir(path.join(dataDir, "scenes", "s1"), { recursive: true });
    await writeFile(sceneFile("s1", "broken.json"), "{not json");
    await expect(store.readJson("s1", "broken.json")).rejects.toThrow(/broken\.json/);
  });

  it("refuses paths that escape the scene folder", async () => {
    await expect(store.writeJson("s1", "../s2/x.json", {})).rejects.toThrow(/file/i);
    await expect(store.readJson("../s2", "x.json")).rejects.toThrow(/scene id/i);
  });
});

describe("appendJsonl", () => {
  it("appends one JSON object per line", async () => {
    await store.appendJsonl("s1", "agent-steps.jsonl", { n: 1 });
    await store.appendJsonl("s1", "agent-steps.jsonl", { n: 2, text: "line\nbreak" });
    const lines = (await readFile(sceneFile("s1", "agent-steps.jsonl"), "utf8")).split("\n");
    expect(lines).toEqual(['{"n":1}', '{"n":2,"text":"line\\nbreak"}', ""]);
  });

  it("keeps every row under concurrent appends", async () => {
    await Promise.all(Array.from({ length: 50 }, (_, n) => store.appendJsonl("s1", "log.jsonl", { n })));
    const rows = (await readFile(sceneFile("s1", "log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { n: number });
    expect(rows.map((r) => r.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, n) => n));
  });
});

describe("saveResult", () => {
  it("stores results.json as an array, replacing in place and appending new claims", async () => {
    await store.saveResult("s1", result("c1"));
    await store.saveResult("s1", result("c2", "Supported"));
    await store.saveResult("s1", result("c3"));
    await store.saveResult("s1", result("c1", "Contradicted"));
    expect(await store.readJson("s1", "results.json")).toEqual([
      result("c1", "Contradicted"),
      result("c2", "Supported"),
      result("c3"),
    ]);
  });

  it("loses no results under concurrent saves and keeps call order", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.saveResult("s1", result(`c${i}`))));
    const all = await store.readJson<ClaimResult[]>("s1", "results.json");
    expect(all.map((r) => r.claimId)).toEqual(Array.from({ length: 20 }, (_, i) => `c${i}`));
  });

  it("keeps one entry per claim when the same claim is saved concurrently", async () => {
    await store.saveResult("s1", result("c0"));
    await Promise.all([
      store.saveResult("s1", result("c1")),
      store.saveResult("s1", result("c0", "Supported")),
      store.saveResult("s1", result("c0", "Contradicted")),
    ]);
    expect(await store.readJson("s1", "results.json")).toEqual([result("c0", "Contradicted"), result("c1")]);
  });

  it("refuses to overwrite a results.json that is not an array", async () => {
    await store.writeJson("s1", "results.json", { c1: result("c1") });
    await expect(store.saveResult("s1", result("c2"))).rejects.toThrow(/results\.json/);
  });
});
