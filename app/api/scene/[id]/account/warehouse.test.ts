// OWNER: Dev 2. Offline warehouse demo through POST /api/scene/[id]/account, using Dev 1's real
// WAREHOUSE_QUESTIONS. Carbon, checkWindow() and the budget guard are mocked; everything else is real.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim, ClaimResult, Evidence, Event } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

const SCENE = "wh1";
let dataDir = "";
const prevDataDir = process.env.DATA_DIR;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  return {
    POST: (await import("@/app/api/scene/[id]/account/route")).POST,
    gen: vi.mocked((await import("@/lib/gemini/client")).generateJson),
    checkWindow: vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow),
    QUESTIONS: (await import("@/lib/perception/questionSets")).WAREHOUSE_QUESTIONS,
    fakeGrid: (await import("@/lib/inference/fake-grid")).fakeGrid,
  };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-warehouse-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  m = await load();
  m.gen.mockReset();
  m.checkWindow.mockReset();
  m.checkWindow.mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => ({
    camera: a.camera,
    window: a.window,
    visible: 0.9,
    supports: 0.91,
    contradicts: 0.04,
    clipId: "real-clip",
    source: a.source,
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });
const MATCHING = [
  { id: "forklift", description: "yellow forklift" },
  { id: "pedestrian", description: "person figure" },
];

async function writeScene(entities: unknown, durationS = 16) {
  const dir = path.join(dataDir, "scenes", SCENE);
  await mkdir(dir, { recursive: true });
  const rows = m.fakeGrid({
    sceneId: SCENE,
    cameras: ["A", "B"],
    durationS: 16,
    truth: [ev("forklift", "unknown", "at entry line", 0), ev("forklift", "at entry line", "past entry line", 6), ev("pedestrian", "unknown", "inside crossing", 0)],
    questions: m.QUESTIONS,
    noise: 0.1,
    sharedErrorRate: 0,
    seed: 2,
  });
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ sceneId: SCENE, split: "demo", room: "warehouse", cameras: ["A", "B"], excludedCameras: [], files: {}, durationS, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
    "entities.json": JSON.stringify(entities),
    "people.json": "[]",
    "questions.json": JSON.stringify(m.QUESTIONS),
    "grid.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  };
  for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, f), text);
}

// Natural witness wording, as Carbon would return it: state values keep the witness's articles.
const TRANSCRIPT = "Around 7 seconds the forklift went past the entry line. The pedestrian was inside the crossing. At 00:06 the forklift was stationary.";
const wire = (o: Partial<ClaimWire>): ClaimWire => ({ text: "", actor: "", object: "forklift", actionKind: "state", timeKind: "exact", hedged: false, ...o });
const CLAIMS: ClaimWire[] = [
  wire({ text: "The forklift went past the entry line", stateValue: "past the entry line", timeKind: "approx", t: 7 }),
  wire({ text: "The pedestrian was inside the crossing", object: "pedestrian", stateValue: "inside the crossing", timeKind: "none" }),
  wire({ text: "The forklift was stationary", stateValue: "stationary", t: 6 }),
];
const post = async () => {
  m.gen.mockResolvedValueOnce({ claims: CLAIMS } as never);
  const res = await m.POST(new Request(`http://local/api/scene/${SCENE}/account`, { method: "POST", body: JSON.stringify({ transcript: TRANSCRIPT }) }), { params: Promise.resolve({ id: SCENE }) });
  return { status: res.status, out: (await res.json()) as ClaimResult[] };
};
const claimsFile = async () => JSON.parse(await readFile(path.join(dataDir, "scenes", SCENE, "claims.json"), "utf8")) as Claim[];

describe("warehouse scene through the account endpoint", () => {
  it("extracts natural wording, grounds to the warehouse questions and labels safely", async () => {
    await writeScene(MATCHING);
    const { status, out } = await post();
    expect(status).toBe(200);
    const claims = await claimsFile();
    expect(claims.map((c) => c.action)).toEqual(["state past entry line", "state inside crossing", "state stationary"]);
    expect(claims[1]).toMatchObject({ window: [0, 16], timeIsPrecise: false }); // untimed: whole scene, never precise
    // past entry line (true after 6 s) and inside crossing (true all scene) are Supported; "stationary" is
    // false here but state claims are never contradicted, so it is Insufficient with no audit.
    expect(out.map((r) => r.verdict)).toEqual(["Supported", "Supported", "Insufficient"]);
    expect(out[2]!.audit).toBeNull();
    expect(m.checkWindow).toHaveBeenCalledTimes(2);
    for (const call of m.checkWindow.mock.calls) {
      const c = claims.find((x) => x.text === call[0].claim.text)!;
      expect(call[0].window[0]).toBeGreaterThanOrEqual(c.window[0]);
      expect(call[0].window[1]).toBeLessThanOrEqual(c.window[1]);
    }
  });

  it("without a scene duration the untimed claim is withheld, the timed ones are unchanged", async () => {
    await writeScene(MATCHING);
    const withD = await post();
    const withIds = (await claimsFile()).map((c) => c.id);
    await writeScene(MATCHING, 0); // durationS 0 = unknown
    const noD = await post();
    const noIds = (await claimsFile()).map((c) => c.id);
    expect(noIds).toEqual([withIds[0], withIds[2]]);
    expect(noD.out.map((r) => r.verdict)).toEqual([withD.out[0]!.verdict, withD.out[2]!.verdict]);
  });

  it("entity ids that do not match the question set stay Insufficient with no audit", async () => {
    await writeScene([
      { id: "forklift_1", description: "yellow forklift" },
      { id: "pedestrian_1", description: "person figure" },
    ]);
    const { status, out } = await post();
    expect(status).toBe(200);
    expect(out.every((r) => r.verdict === "Insufficient" && r.audit === null)).toBe(true);
    expect(out.every((r) => r.evidence.every((e) => e.supports === null && e.contradicts === null))).toBe(true);
    expect(m.checkWindow).not.toHaveBeenCalled();
  });
});
