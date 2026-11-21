// OWNER: Dev 3. Tests for investigate() and challenge(): eligibility refusals and full stand-in runs with a
// fake model, against a temp DATA_DIR. Dev 2's real verdict()/enforceDowngradeOnly()/isWeakSupport() are used.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { AgentStep, Audit, Claim, ClaimResult, Evidence, Verdict } from "@/lib/types";
import type { ModelReply, ModelRequest, StandinModel } from "@/lib/agent/standin";

type Store = typeof import("@/lib/store/scene");
type Inv = typeof import("@/lib/agent/investigator");
type Sk = typeof import("@/lib/agent/skeptic");
let store: Store;
let investigate: Inv["investigate"];
let challenge: Sk["challenge"];
let dataDir: string;
const prevDataDir = process.env.DATA_DIR;
const prevKey = process.env.GEMINI_API_KEY;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-agents-"));
  process.env.DATA_DIR = dataDir;
  delete process.env.GEMINI_API_KEY;
  vi.resetModules();
  store = await import("@/lib/store/scene");
  ({ investigate } = await import("@/lib/agent/investigator"));
  ({ challenge } = await import("@/lib/agent/skeptic"));
  await store.createScene(
    { split: "dev", room: "studio", cameras: ["A", "B", "C", "D"], excludedCameras: ["D"] },
    { id: "s1" },
  );
  await store.writeJson("s1", "views.json", [
    { camera: "B", text: "side-on to zone C" },
    { camera: "D", text: "EXCLUDED VIEW" },
  ]);
  await store.writeJson("s1", "stills.json", { B: "still-B", D: "still-D" });
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = prevKey;
  vi.restoreAllMocks();
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
  timeIsPrecise: true,
};

const ev = (camera: Evidence["camera"], o: Partial<Evidence>): Evidence => ({
  camera,
  window: [10, 14],
  visible: 0.95,
  supports: null,
  contradicts: null,
  clipId: `init-${camera}`,
  source: "initial",
  ...o,
});
const sup = (c: Evidence["camera"]) => ev(c, { supports: 0.95, contradicts: 0.01 });
const con = (c: Evidence["camera"]) => ev(c, { supports: 0.01, contradicts: 0.95 });

function result(verdict: Verdict, evidence: Evidence[], audit: Audit | null = null): ClaimResult {
  return { claimId: "c1", verdict, evidence, audit, history: [] };
}

const insufficient = () => result("Insufficient", [ev("A", { visible: 0.3 }), ev("D", { visible: 0.3 })]);
const contradicted = () =>
  result("Contradicted", [con("A")], { supportScore: 0.01, contradictScore: 0.95, clipId: "init-A" });
const strongSupported = () =>
  result("Supported", [sup("A"), sup("B")], { supportScore: 0.95, contradictScore: 0.01, clipId: "init-A" });

function fakeModel(calls: { name: string; args: unknown }[]): StandinModel & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    generate: vi.fn(async (req: ModelRequest): Promise<ModelReply> => {
      const call = calls[requests.length] ?? { name: "stop", args: { reason: "done" } };
      requests.push(req);
      return { call, text: null, inputTokens: 100, outputTokens: 10, costUsd: 0.0001 };
    }),
  };
}

/** Fake Dev 1 checkWindow(): camera B clearly supports, every other camera sees nothing useful. */
const checkWindow = vi.fn(async (a: CheckWindowArgs): Promise<Evidence> => ({
  camera: a.camera,
  window: a.window,
  visible: a.camera === "B" ? 0.95 : 0.2,
  supports: a.camera === "B" ? 0.95 : null,
  contradicts: a.camera === "B" ? 0.01 : null,
  clipId: `clip-${a.camera}-${a.window[0]}`,
  source: a.source,
}));
const audit = vi.fn(async (_c: Claim, e: Evidence): Promise<Audit> => ({
  supportScore: e.supports,
  contradictScore: e.contradicts,
  clipId: e.clipId,
}));
const fakes = (model: StandinModel) => ({ model, checkWindow, audit, assertBudget: async () => {} });
const inspectB = { name: "inspect_window", args: { camera_id: "B", start_s: 10, end_s: 13, crop: "full", reason: "side view" } };

describe("refusals (never throw)", () => {
  it.each([
    ["investigate", "a strong Supported claim", strongSupported, /strong supported/i],
    ["challenge", "a strong Supported claim", strongSupported, /strong supported/i],
    ["investigate", "a Contradicted claim", contradicted, /skeptic/i],
    ["challenge", "an Insufficient claim", insufficient, /investigator/i],
  ] as const)("%s refuses %s", async (fn, _what, make, reason) => {
    await store.saveResult("s1", make());
    const model = fakeModel([inspectB]);
    const out = await (fn === "investigate" ? investigate : challenge)(claim, "s1", fakes(model));
    expect(out.ran).toBe(false);
    if (!out.ran) expect(out.reason).toMatch(reason);
    expect(model.generate).not.toHaveBeenCalled();
    expect(await store.loadResults("s1")).toEqual([make()]); // nothing changed
  });

  it("refuses a claim with no saved result", async () => {
    const out = await investigate(claim, "s1", fakes(fakeModel([])));
    expect(out).toEqual({ ran: false, reason: expect.stringMatching(/no result for claim c1/i) });
  });

  it("refuses a missing scene and a claim from another scene", async () => {
    expect(await investigate({ ...claim, sceneId: "nope" }, "nope", fakes(fakeModel([])))).toMatchObject({
      ran: false,
      reason: expect.stringMatching(/scene nope not found/i),
    });
    expect(await investigate(claim, "other", fakes(fakeModel([])))).toMatchObject({
      ran: false,
      reason: expect.stringMatching(/belongs to scene s1/i),
    });
  });

  it("refuses managed mode until the Interactions API is wired", async () => {
    await store.saveResult("s1", insufficient());
    const out = await investigate(claim, "s1", { ...fakes(fakeModel([])), mode: "managed" });
    expect(out).toMatchObject({ ran: false, reason: expect.stringMatching(/managed/i) });
  });

  it("refuses with a reason when the stand-in model can't be created (no API key)", async () => {
    await store.saveResult("s1", insufficient());
    const out = await investigate(claim, "s1", { checkWindow, audit, assertBudget: async () => {} });
    expect(out).toMatchObject({ ran: false, reason: expect.stringMatching(/model unavailable.*GEMINI_API_KEY/) });
  });
});

describe("excluded cameras", () => {
  it("a claim whose only supporting evidence is from an excluded camera stays Insufficient after a run", async () => {
    // D is excluded. Its clip strongly supports the claim; the auditor (faked) also supports it.
    const supportingAudit: Audit = { supportScore: 0.95, contradictScore: 0.01, clipId: "init-D" };
    await store.saveResult("s1", result("Insufficient", [sup("D")], supportingAudit));
    const model = fakeModel([
      { name: "inspect_window", args: { camera_id: "C", start_s: 10, end_s: 13, crop: "full", reason: "wide view" } },
      { name: "stop", args: { reason: "nothing else" } },
    ]);
    const out = await investigate(claim, "s1", { ...fakes(model), audit: async () => supportingAudit });

    expect(out.ran).toBe(true);
    if (!out.ran) return;
    // Without the filter, verdict() would see D's support plus a supporting audit and return Supported.
    expect(out.run.result.verdict).toBe("Insufficient");
    expect(out.run.result.history).toEqual([]);
    expect((await store.loadResults("s1"))[0]?.verdict).toBe("Insufficient");
  });

  it("eligibility ignores excluded cameras: support from A plus excluded D is weak, so the skeptic runs", async () => {
    // Counting D, two cameras support (strong: nobody runs). Without D, one camera supports (weak: skeptic).
    await store.saveResult(
      "s1",
      result("Supported", [sup("A"), sup("D")], { supportScore: 0.95, contradictScore: 0.01, clipId: "init-A" }),
    );
    const out = await challenge(claim, "s1", fakes(fakeModel([])));
    expect(out.ran).toBe(true);
  });
});

describe("full stand-in runs with a fake model", () => {
  it("investigate: settles an Insufficient claim and saves the result and steps", async () => {
    await store.saveResult("s1", insufficient());
    const model = fakeModel([inspectB, { name: "stop", args: { reason: "settled" } }]);

    const out = await investigate(claim, "s1", fakes(model));

    expect(out.ran).toBe(true);
    if (!out.ran) return;
    expect(out.run.stopReason).toBe("agent");
    expect(out.run.steps.map((s) => s.action)).toEqual(["inspect_window", "stop"]);
    expect(out.run.result.verdict).toBe("Supported"); // Dev 2's real verdict() on the new clip
    expect(out.run.result.history).toEqual([
      expect.objectContaining({ from: "Insufficient", to: "Supported", by: "investigator" }),
    ]);
    expect(checkWindow).toHaveBeenCalledWith(expect.objectContaining({ sceneId: "s1", camera: "B", source: "investigator" }));

    // Saved through the store.
    expect(await store.loadResults("s1")).toEqual([out.run.result]);
    const steps = (await readFile(path.join(dataDir, "scenes", "s1", "agent-steps.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as AgentStep);
    expect(steps).toEqual(out.run.steps);

    // The model only ever saw the menu: no excluded camera D, no other files.
    const seen = model.requests.map((r) => r.userText).join("\n");
    expect(seen).toContain("still-B");
    expect(seen).not.toMatch(/EXCLUDED|still-D|"D"/);
    expect(model.requests[0]?.systemInstruction).toMatch(/evidence investigator/);
  });

  it("challenge: a second view downgrades a wrong Contradicted to Insufficient", async () => {
    await store.saveResult("s1", contradicted());
    const model = fakeModel([inspectB]);

    const out = await challenge(claim, "s1", fakes(model));

    expect(out.ran).toBe(true);
    if (!out.ran) return;
    expect(out.run.result.verdict).toBe("Insufficient");
    expect(out.run.result.history).toEqual([
      expect.objectContaining({ from: "Contradicted", to: "Insufficient", by: "skeptic" }),
    ]);
    expect(model.requests[0]?.systemInstruction).toMatch(/skeptic/);
    expect((await store.loadResults("s1"))[0]?.verdict).toBe("Insufficient");
  });

  it("challenge on a weak Supported claim runs the skeptic", async () => {
    await store.saveResult(
      "s1",
      result("Supported", [sup("A")], { supportScore: 0.95, contradictScore: 0.01, clipId: "init-A" }),
    );
    const out = await challenge(claim, "s1", fakes(fakeModel([])));
    expect(out).toMatchObject({ ran: true, run: { stopReason: "agent" } });
  });
});
