// OWNER: Dev 2. Persistence race regression for runAccount(): an agent-updated result that lands right
// before the account's own write must never be overwritten. The store is real; it is only wrapped to
// inject that concurrent write at the worst moment.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Evidence, Event } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

/** Called right before any results.json write for a claim; tests use it to inject a concurrent writer. */
const hook: { beforeWrite: ((claimId: string) => Promise<void>) | null } = { beforeWrite: null };
vi.mock("@/lib/store/scene", async (orig) => {
  const real = await orig<typeof import("@/lib/store/scene")>();
  const once = async (id: string) => {
    const h = hook.beforeWrite;
    if (h) {
      hook.beforeWrite = null;
      await h(id);
    }
  };
  return {
    ...real,
    saveResult: async (sceneId: string, r: ClaimResult) => (await once(r.claimId), real.saveResult(sceneId, r)),
    saveResultIf: async (sceneId: string, r: ClaimResult, expected: ClaimResult | null) => (await once(r.claimId), real.saveResultIf(sceneId, r, expected)),
  };
});

// One DATA_DIR for the whole file: the wrapped (mocked) store module is created once and keeps the config
// it first loaded, so each test uses its own scene id instead of its own DATA_DIR.
let SCENE = "";
let n = 0;
let dataDir = "";
const prevDataDir = process.env.DATA_DIR;
beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-race-"));
  process.env.DATA_DIR = dataDir;
});
beforeEach(() => {
  SCENE = `race${++n}`;
  hook.beforeWrite = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });

async function scene() {
  const { WAREHOUSE_QUESTIONS } = await import("@/lib/perception/questionSets");
  const { fakeGrid } = await import("@/lib/inference/fake-grid");
  const dir = path.join(dataDir, "scenes", SCENE);
  await mkdir(dir, { recursive: true });
  const rows = fakeGrid({ sceneId: SCENE, cameras: ["A", "B"], durationS: 12, truth: [ev("forklift", "unknown", "at entry line", 0), ev("forklift", "at entry line", "past entry line", 6)], questions: WAREHOUSE_QUESTIONS, noise: 0.1, sharedErrorRate: 0, seed: 9 });
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ sceneId: SCENE, split: "dev", room: "test", cameras: ["A", "B"], excludedCameras: [], files: {}, durationS: 12, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
    "entities.json": JSON.stringify([{ id: "forklift", description: "forklift" }]),
    "people.json": "[]",
    "questions.json": JSON.stringify(WAREHOUSE_QUESTIONS),
    "grid.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  };
  for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, f), text);
  return dir;
}

const CLAIMS: ClaimWire[] = [{ text: "The forklift went past the entry line", actor: "", object: "forklift", actionKind: "state", stateValue: "past the entry line", timeKind: "approx", t: 8, hedged: false }];
const TRANSCRIPT = "Around 8 seconds the forklift went past the entry line.";

describe("runAccount persistence under a concurrent agent write", () => {
  it("an agent update landing right before the account's write is kept, not overwritten", async () => {
    const dir = await scene();
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    const cw = vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow);
    const store = await import("@/lib/store/scene");
    cw.mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.9, contradicts: 0.05, clipId: "c", source: a.source }));
    const post = async () => {
      gen.mockResolvedValueOnce({ claims: CLAIMS } as never);
      const res = await POST(new Request(`http://local/api/scene/${SCENE}/account`, { method: "POST", body: JSON.stringify({ transcript: TRANSCRIPT }) }), { params: Promise.resolve({ id: SCENE }) });
      expect(res.status).toBe(200);
      return (await res.json()) as ClaimResult[];
    };

    const first = await post();
    expect(first[0]!.verdict).toBe("Supported");

    // Second account run: just before it writes this claim, an agent saves an update for it.
    const agent: ClaimResult = {
      ...first[0]!,
      verdict: "Insufficient",
      history: [{ from: "Supported", to: "Insufficient", by: "skeptic", reason: "camera B blocked", at: "2026-11-21T16:00:00.000Z" }],
    };
    // Make the second run recompute (drop the stored entry so it is not treated as agent-touched up front).
    await store.removeResult(SCENE, first[0]!.claimId);
    hook.beforeWrite = async (claimId) => {
      if (claimId === agent.claimId) await (await import("@/lib/store/scene")).saveResultIf(SCENE, agent, null);
    };
    const second = await post();

    const saved = JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as ClaimResult[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(agent); // the agent's write survived
    expect(second[0]).toEqual(agent); // and the response reports what is actually stored
  });

  it("without a concurrent writer the account saves its own result", async () => {
    const dir = await scene();
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    vi.mocked((await import("@/lib/gemini/client")).generateJson).mockResolvedValueOnce({ claims: CLAIMS } as never);
    vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow).mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.9, contradicts: 0.05, clipId: "c", source: a.source }));
    const res = await POST(new Request(`http://local/api/scene/${SCENE}/account`, { method: "POST", body: JSON.stringify({ transcript: TRANSCRIPT }) }), { params: Promise.resolve({ id: SCENE }) });
    const body = (await res.json()) as unknown;
    expect({ status: res.status, body }).toMatchObject({ status: 200 });
    expect(JSON.parse(await readFile(path.join(dir, "results.json"), "utf8"))).toEqual(body);
  });
});
