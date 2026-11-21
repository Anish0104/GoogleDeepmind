// OWNER: Dev 3. Tests for buildMenu(): the only thing an agent sees. Uses a temp DATA_DIR.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/config";
import type { Claim, ClaimResult, Evidence, SceneManifest } from "@/lib/types";

type Menu = typeof import("@/lib/agent/menu");
type Store = typeof import("@/lib/store/scene");
let menuMod: Menu;
let store: Store;
let dataDir: string;
const prev = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-menu-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  store = await import("@/lib/store/scene");
  menuMod = await import("@/lib/agent/menu");
});

afterEach(async () => {
  if (prev === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prev;
  await rm(dataDir, { recursive: true, force: true });
});

const claim: Claim = {
  id: "c1",
  sceneId: "s1",
  text: "I put the red cup in zone C",
  actor: "speaker",
  object: "red cup",
  action: "place",
  window: [10, 14],
  timeIsPrecise: false,
};

const manifest: SceneManifest = {
  sceneId: "s1",
  split: "dev",
  room: "studio",
  cameras: ["A", "B", "C", "D"],
  excludedCameras: ["D"],
  files: {},
  durationS: 15,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: true,
};

const ev = (camera: Evidence["camera"], window: [number, number]): Evidence => ({
  camera,
  window,
  visible: 0.9,
  supports: 0.5,
  contradicts: 0.1,
  clipId: `clip-${camera}`,
  source: "initial",
});

const result: ClaimResult = {
  claimId: "c1",
  verdict: "Insufficient",
  evidence: [ev("A", [10, 12]), ev("D", [10, 12]), ev("B", [12, 14])],
  audit: { supportScore: 0.4, contradictScore: 0.1, clipId: "clip-A" },
  history: [{ from: "Insufficient", to: "Supported", by: "investigator", blocked: true, reason: "secret", at: "t" }],
};

async function seed() {
  await store.writeJson("s1", "views.json", [
    { camera: "A", text: "behind the actor" },
    { camera: "B", text: "side-on to zone C" },
    { camera: "D", text: "EXCLUDED VIEW" },
  ]);
  await store.writeJson("s1", "stills.json", { A: "still-A", B: "still-B", D: "still-D-excluded" });
  // Things the menu must never contain:
  await store.saveResult("s1", { ...result, claimId: "other-claim", verdict: "Contradicted" });
  await store.writeJson("s1", "claims.json", [{ id: "other-claim", text: "OTHER CLAIM TEXT" }]);
  await store.writeJson("s1", "labels/gt.json", [{ claimId: "c1", label: "GROUND TRUTH LABEL" }]);
  await store.writeJson("s1", "scripts/script.json", { lines: ["SCRIPT LINE"] });
}

describe("buildMenu", () => {
  it("builds exactly the allowlisted menu", async () => {
    await seed();
    const menu = await menuMod.buildMenu("investigator", claim, result, manifest);
    expect(menu).toEqual({
      agent: "investigator",
      claim,
      currentVerdict: "Insufficient",
      evidence: [ev("A", [10, 12]), ev("B", [12, 14])],
      views: [
        { camera: "A", text: "behind the actor" },
        { camera: "B", text: "side-on to zone C" },
      ],
      stillIds: { A: "still-A", B: "still-B" },
      includedCameras: ["A", "B", "C"],
      allowedRangeS: [10 - LIMITS.AGENT_RANGE_PAD_S, 15], // clamped to the scene duration
      alreadyChecked: [
        { camera: "A", window: [10, 12] },
        { camera: "B", window: [12, 14] },
      ],
      followUpsLeft: LIMITS.AGENT_MAX_CHECKS,
    });
  });

  it("never includes excluded cameras", async () => {
    await seed();
    const menu = await menuMod.buildMenu("skeptic", claim, result, manifest);
    expect(menu.includedCameras).not.toContain("D");
    expect(menu.evidence.map((e) => e.camera)).not.toContain("D");
    expect(menu.views.map((v) => v.camera)).not.toContain("D");
    expect(menu.stillIds).not.toHaveProperty("D");
    expect(menu.alreadyChecked.map((c) => c.camera)).not.toContain("D");
    expect(JSON.stringify(menu)).not.toMatch(/EXCLUDED|still-D/);
  });

  it("never includes other claims' labels, scripts, ground truth, history or the audit", async () => {
    await seed();
    const text = JSON.stringify(await menuMod.buildMenu("investigator", claim, result, manifest));
    for (const leak of ["other-claim", "OTHER CLAIM", "GROUND TRUTH", "SCRIPT LINE", "Contradicted", "secret", "plannedOcclusion", "history", "audit"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("works with no views.json or stills.json", async () => {
    const menu = await menuMod.buildMenu("investigator", claim, result, manifest);
    expect(menu.views).toEqual([]);
    expect(menu.stillIds).toEqual({});
  });

  it("pads the claim window and clamps at 0; no upper clamp when duration is unknown", async () => {
    const early = { ...claim, window: [1, 3] as [number, number] };
    const menu = await menuMod.buildMenu("investigator", early, result, { ...manifest, durationS: 0 });
    expect(menu.allowedRangeS).toEqual([0, 3 + LIMITS.AGENT_RANGE_PAD_S]);
  });

  it("rejects a malformed views.json", async () => {
    await store.writeJson("s1", "views.json", [{ camera: "Z" }]);
    await expect(menuMod.buildMenu("investigator", claim, result, manifest)).rejects.toThrow(/views\.json/);
  });

  it("refuses a claim or result from another scene or claim", async () => {
    await expect(menuMod.buildMenu("investigator", { ...claim, sceneId: "s2" }, result, manifest)).rejects.toThrow(
      /scene/i,
    );
    await expect(
      menuMod.buildMenu("investigator", claim, { ...result, claimId: "c2" }, manifest),
    ).rejects.toThrow(/claim/i);
  });
});

describe("loadResults", () => {
  it("returns [] when results.json is missing, else the saved array", async () => {
    expect(await store.loadResults("s1")).toEqual([]);
    await store.saveResult("s1", result);
    expect(await store.loadResults("s1")).toEqual([result]);
  });
});
