// OWNER: Dev 2. Tests for POST /api/scene/[id]/account with fixture scene files in a temp DATA_DIR.
// Mocked only at external boundaries: Carbon (generateJson), Dev 1's checkWindow() (clip + Decision 1)
// and Dev 3's budget guard. Grounding, evidence, citation selection, auditing and verdict run for real.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraId, Claim, ClaimResult, Evidence, Event } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => {
  const real = await orig<typeof import("@/lib/cost")>();
  return { ...real, assertBudget: vi.fn(async () => undefined) };
});

const SCENE = "acct1";
let dataDir = "";
const prevDataDir = process.env.DATA_DIR;

type Mods = Awaited<ReturnType<typeof load>>;
async function load() {
  const route = await import("@/app/api/scene/[id]/account/route");
  const client = await import("@/lib/gemini/client");
  const cw = await import("@/lib/perception/checkWindow");
  const cost = await import("@/lib/cost");
  const store = await import("@/lib/store/scene");
  const scout = await import("@/lib/perception/scout");
  const fg = await import("@/lib/inference/fake-grid");
  return {
    POST: route.POST,
    gen: vi.mocked(client.generateJson),
    checkWindow: vi.mocked(cw.checkWindow),
    assertBudget: vi.mocked(cost.assertBudget),
    BudgetExceededError: cost.BudgetExceededError,
    saveResult: store.saveResult,
    buildQuestions: scout.buildQuestions,
    fakeGrid: fg.fakeGrid,
  };
}
let m: Mods;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-account-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules(); // DATA_DIR is read when lib/config.ts loads
  m = await load();
  m.gen.mockReset();
  m.checkWindow.mockReset();
  m.assertBudget.mockReset();
  m.assertBudget.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

// ---------- fixture scene ----------

const ENTITIES = [
  { id: "red_mug", description: "red ceramic mug" },
  { id: "blue_mug", description: "blue ceramic mug" },
];
const PEOPLE = [
  { id: "person_1", description: "person in red shirt" },
  { id: "person_2", description: "person in blue shirt" },
];
const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });

const sceneDir = () => path.join(dataDir, "scenes", SCENE);
async function writeScene(o: { excluded?: CameraId[]; occluded?: { camera: CameraId; window: [number, number] }[]; skip?: string[]; raw?: Record<string, string> } = {}) {
  await mkdir(sceneDir(), { recursive: true });
  const questions = m.buildQuestions(ENTITIES, PEOPLE);
  const rows = m.fakeGrid({
    sceneId: SCENE,
    cameras: ["A", "B", "C"],
    durationS: 16,
    truth: [ev("red_mug", "unknown", "B", 0), ev("red_mug", "none", "person_1", 3), ev("red_mug", "person_1", "none", 6), ev("red_mug", "B", "C", 6), ev("blue_mug", "unknown", "E", 0)],
    questions,
    noise: 0.1,
    sharedErrorRate: 0,
    occluded: o.occluded ?? [{ camera: "C", window: [2, 9] }],
    seed: 4,
  });
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({
      sceneId: SCENE,
      split: "dev",
      room: "lab",
      cameras: ["A", "B", "C"],
      excludedCameras: o.excluded ?? [],
      files: {},
      durationS: 16,
      createdAt: "2026-11-21T00:00:00.000Z",
      plannedOcclusion: true,
    }),
    "entities.json": JSON.stringify(ENTITIES),
    "people.json": JSON.stringify(PEOPLE),
    "questions.json": JSON.stringify(questions),
    "grid.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    ...(o.raw ?? {}),
  };
  for (const [f, text] of Object.entries(files)) if (!(o.skip ?? []).includes(f)) await writeFile(path.join(sceneDir(), f), text);
  return rows;
}

// ---------- requests ----------

const TRANSCRIPT =
  "At 00:06 Sam moved the red mug into zone C. At 00:04 the person in red shirt picked up the red mug. " +
  "At 00:06 Sam moved the mug into zone C. At 00:06 Sam moved the red mug into zone E.";
const wire = (o: Partial<ClaimWire>): ClaimWire => ({
  text: "Sam moved the red mug into zone C",
  actor: "Sam",
  object: "red mug",
  actionKind: "move",
  zone: "C",
  timeKind: "exact",
  t: 6,
  hedged: false,
  ...o,
});
const CLAIMS: ClaimWire[] = [
  wire({}),
  wire({ text: "The person in red shirt picked up the red mug", actor: "person in red shirt", actionKind: "take", zone: undefined, t: 4 }),
  wire({ text: "Sam moved the mug into zone C", object: "mug" }),
  wire({ text: "Sam moved the red mug into zone E", zone: "E" }),
];
const carbon = (claims: ClaimWire[] = CLAIMS) => m.gen.mockResolvedValueOnce({ claims } as never);

/** checkWindow() stand-in: Decision 1 answers by the claim text, for exactly the requested window. */
function decisionOne(over: Partial<Evidence> = {}) {
  m.checkWindow.mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => {
    const isFalse = a.claim.text.includes("zone E");
    return { camera: a.camera, window: a.window, visible: 0.9, supports: isFalse ? 0.02 : 0.92, contradicts: isFalse ? 0.95 : 0.03, clipId: "real-clip", source: a.source, ...over };
  });
}

const post = (body: unknown, id = SCENE) =>
  m.POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const readScene = async <T>(f: string): Promise<T> => JSON.parse(await readFile(path.join(sceneDir(), f), "utf8")) as T;

// ---------- tests ----------

describe("POST /api/scene/[id]/account: pipeline", () => {
  it("extracts, grounds, audits and labels several claims with different outcomes", async () => {
    await writeScene();
    carbon();
    decisionOne();
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.status).toBe(200);
    const out = (await res.json()) as ClaimResult[];
    expect(out.map((r) => r.verdict)).toEqual(["Supported", "Supported", "Insufficient", "Contradicted"]);
    expect(m.checkWindow).toHaveBeenCalledTimes(3); // not for the ambiguous "mug"
    expect(out[2]!.audit).toBeNull();
    for (const r of out) {
      expect(r.history).toEqual([]);
      if (r.audit) expect(r.audit.clipId).toMatch(/^grid:acct1:[A-D]:/); // grid reference, not a playable clip
    }
    expect(m.gen).toHaveBeenCalledTimes(1);
  });

  it("saves claims.json and results.json exactly as returned, for the board", async () => {
    await writeScene();
    carbon();
    decisionOne();
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    const claims = await readScene<Claim[]>("claims.json");
    expect(claims.map((c) => c.id)).toEqual(out.map((r) => r.claimId));
    expect(claims[0]).toMatchObject({ sceneId: SCENE, action: "move to zone C", window: [5, 8], timeIsPrecise: true });
    expect(await readScene<ClaimResult[]>("results.json")).toEqual(out);
  });

  it("audits only the selected window, inside the claim, on an allowed camera", async () => {
    await writeScene();
    carbon([CLAIMS[0]!]);
    decisionOne();
    await post({ transcript: TRANSCRIPT });
    const a = m.checkWindow.mock.calls[0]![0];
    expect(a.window[0]).toBeGreaterThanOrEqual(5);
    expect(a.window[1]).toBeLessThanOrEqual(8);
    expect(a.window[1] - a.window[0]).toBeLessThanOrEqual(4);
    expect(a.camera).not.toBe("C"); // occluded 2-9 s
  });

  it("an ambiguous identity is Insufficient with no Decision 1 call", async () => {
    await writeScene();
    carbon([CLAIMS[2]!]);
    decisionOne();
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out[0]).toMatchObject({ verdict: "Insufficient", audit: null });
    expect(out[0]!.evidence.every((e) => e.supports === null && e.contradicts === null)).toBe(true);
    expect(m.checkWindow).not.toHaveBeenCalled();
  });
});

describe("POST /api/scene/[id]/account: cameras", () => {
  it("never uses excluded cameras, even when they see everything clearly", async () => {
    await writeScene({ excluded: ["A", "B"] });
    carbon();
    decisionOne();
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    for (const r of out) for (const e of r.evidence) expect(["A", "B"]).not.toContain(e.camera);
    for (const call of m.checkWindow.mock.calls) expect(call[0].camera).toBe("C");
  });

  it("with only an excluded camera able to see, nothing is labelled", async () => {
    await writeScene({ excluded: ["A", "B"], occluded: [{ camera: "C", window: [0, 16] }] });
    carbon();
    decisionOne();
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out.every((r) => r.verdict === "Insufficient" && r.audit === null)).toBe(true);
    expect(m.checkWindow).not.toHaveBeenCalled();
  });
});

describe("POST /api/scene/[id]/account: missing and malformed inputs", () => {
  it.each(["questions.json", "entities.json", "people.json", "grid.jsonl"])("a missing %s gives Insufficient labels, never evidence", async (f) => {
    await writeScene({ skip: [f] });
    carbon();
    decisionOne();
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.status).toBe(200);
    const out = (await res.json()) as ClaimResult[];
    // Without people.json only the take claim loses its grounding; everything else stays safe.
    if (f === "people.json") expect(out[1]).toMatchObject({ verdict: "Insufficient", audit: null });
    else expect(out.every((r) => r.verdict === "Insufficient" && r.audit === null)).toBe(true);
  });

  it.each([
    ["questions.json", "{not json"],
    ["entities.json", '{"red_mug": true}'],
    ["people.json", "42"],
  ])("a malformed %s is a 422 with no model call", async (f, text) => {
    await writeScene({ raw: { [f]: text } });
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(f);
    expect(m.gen).not.toHaveBeenCalled();
  });

  it("skips unparseable grid lines (e.g. a half-written last append) instead of failing", async () => {
    const rows = await writeScene();
    await writeFile(path.join(sceneDir(), "grid.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + '\n{"sceneId":"acct1","cam');
    carbon([CLAIMS[0]!]);
    decisionOne();
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out[0]!.verdict).toBe("Supported");
  });

  it("a malformed manifest is a 422", async () => {
    await writeScene({ raw: { "manifest.json": JSON.stringify({ sceneId: SCENE }) } });
    expect((await post({ transcript: TRANSCRIPT })).status).toBe(422);
  });

  it("an unknown scene is a 404 and an unsafe id a 400", async () => {
    expect((await post({ transcript: TRANSCRIPT }, "nope")).status).toBe(404);
    expect((await post({ transcript: TRANSCRIPT }, "../etc")).status).toBe(400);
    expect(m.gen).not.toHaveBeenCalled();
  });

  it.each([["not json", "{"], ["no transcript", {}], ["non-string transcript", { transcript: 5 }], ["blank transcript", { transcript: "   " }]])(
    "a bad body (%s) is a 400 with no model call and nothing written",
    async (_n, body) => {
      await writeScene();
      expect((await post(body)).status).toBe(400);
      expect(m.gen).not.toHaveBeenCalled();
      await expect(readFile(path.join(sceneDir(), "claims.json"))).rejects.toThrow();
    },
  );
});

describe("POST /api/scene/[id]/account: failures", () => {
  it("claim extraction failure is a 502, not an empty result, and writes nothing", async () => {
    await writeScene();
    m.gen.mockRejectedValueOnce(new Error("model unavailable"));
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.status).toBe(502);
    await expect(readFile(path.join(sceneDir(), "claims.json"))).rejects.toThrow();
    await expect(readFile(path.join(sceneDir(), "results.json"))).rejects.toThrow();
  });

  it("budget exhausted before extraction is a 429 with no model call", async () => {
    await writeScene();
    m.assertBudget.mockRejectedValueOnce(new m.BudgetExceededError({ spentUsd: 9, hardStopUsd: 8, blocked: true }));
    const res = await post({ transcript: TRANSCRIPT });
    expect(res.status).toBe(429);
    expect(m.gen).not.toHaveBeenCalled();
  });

  it("an unreadable budget fails closed (503)", async () => {
    await writeScene();
    m.assertBudget.mockRejectedValueOnce(new Error("EACCES"));
    expect((await post({ transcript: TRANSCRIPT })).status).toBe(503);
    expect(m.gen).not.toHaveBeenCalled();
  });

  it("budget exhausted during audits leaves the remaining claims Insufficient without auditing them", async () => {
    await writeScene();
    carbon();
    decisionOne();
    m.assertBudget
      .mockResolvedValueOnce(undefined) // before extraction
      .mockResolvedValueOnce(undefined) // first audit
      .mockRejectedValue(new m.BudgetExceededError({ spentUsd: 9, hardStopUsd: 8, blocked: true }));
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out.map((r) => r.verdict)).toEqual(["Supported", "Insufficient", "Insufficient", "Insufficient"]);
    expect(m.checkWindow).toHaveBeenCalledTimes(1);
  });

  it("a failed Decision 1 audit is Insufficient for that claim only", async () => {
    await writeScene();
    carbon();
    decisionOne();
    m.checkWindow.mockRejectedValueOnce(new Error("ffmpeg exited 1"));
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out[0]).toMatchObject({ verdict: "Insufficient", audit: null });
    expect(out[1]!.verdict).toBe("Supported");
  });

  it("an occluded audit answer abstains and stays Insufficient", async () => {
    await writeScene();
    carbon([CLAIMS[0]!]);
    decisionOne({ visible: 0.2 });
    const out = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(out[0]).toMatchObject({ verdict: "Insufficient", audit: { supportScore: null, contradictScore: null } });
  });
});

describe("POST /api/scene/[id]/account: repeated requests", () => {
  it("a repeated request neither duplicates nor leaves stale results", async () => {
    await writeScene();
    carbon();
    decisionOne();
    const first = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    carbon();
    const second = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(second).toEqual(first);
    const saved = await readScene<ClaimResult[]>("results.json");
    expect(saved).toHaveLength(4);
    expect(new Set(saved.map((r) => r.claimId)).size).toBe(4);
  });

  it("a result already updated by an agent is preserved, not recomputed", async () => {
    await writeScene();
    carbon();
    decisionOne();
    const first = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    const agentUpdated: ClaimResult = {
      ...first[2]!,
      verdict: "Supported",
      history: [{ from: "Insufficient", to: "Supported", by: "investigator", reason: "checked camera A", at: "2026-11-21T12:00:00.000Z" }],
    };
    await m.saveResult(SCENE, agentUpdated);
    m.checkWindow.mockClear();
    carbon();
    const second = (await (await post({ transcript: TRANSCRIPT })).json()) as ClaimResult[];
    expect(second[2]).toEqual(agentUpdated);
    expect((await readScene<ClaimResult[]>("results.json")).find((r) => r.claimId === agentUpdated.claimId)).toEqual(agentUpdated);
    expect(m.checkWindow).toHaveBeenCalledTimes(3); // the other three were recomputed and re-audited
  });

  it("concurrent requests for one scene run one after another and stay consistent", async () => {
    await writeScene();
    carbon();
    carbon();
    decisionOne();
    const [a, b] = await Promise.all([post({ transcript: TRANSCRIPT }), post({ transcript: TRANSCRIPT })]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const saved = await readScene<ClaimResult[]>("results.json");
    expect(saved).toHaveLength(4);
  });
});
