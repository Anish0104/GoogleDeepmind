// OWNER: Dev 2. The files the account endpoint writes load in the board's real loader
// (components/loadScene.ts, Dev 4) and every rendered claim finds its result. Carbon, checkWindow() and
// the budget guard are mocked; grounding, evidence, citation, audit mapping and verdict run for real.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Evidence, Event, Verdict } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

const SCENE = "board1";
let dataDir = "";
const prevDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "rashomon-board-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const ev = (entityId: string, from: string, to: string, t: number): Event => ({ entityId, from, to, t, confidence: 1, cameras: [] });

describe("account output in the board loader", () => {
  it("claims.json and results.json load through loadScene() and join by claimId", async () => {
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    const cw = vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow);
    const { WAREHOUSE_QUESTIONS } = await import("@/lib/perception/questionSets");
    const { fakeGrid } = await import("@/lib/inference/fake-grid");
    const { loadScene } = await import("@/components/loadScene");

    const dir = path.join(dataDir, "scenes", SCENE);
    await mkdir(dir, { recursive: true });
    const rows = fakeGrid({
      sceneId: SCENE,
      cameras: ["A", "B", "C"],
      durationS: 16,
      truth: [ev("forklift", "unknown", "at entry line", 0), ev("forklift", "at entry line", "past entry line", 6), ev("pedestrian", "unknown", "inside crossing", 0)],
      questions: WAREHOUSE_QUESTIONS,
      noise: 0.1,
      sharedErrorRate: 0,
      seed: 3,
    });
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify({ sceneId: SCENE, split: "demo", room: "warehouse", cameras: ["A", "B", "C"], excludedCameras: ["C"], files: {}, durationS: 16, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
      "entities.json": JSON.stringify([{ id: "forklift", description: "yellow forklift" }, { id: "pedestrian", description: "person figure" }]),
      "people.json": "[]",
      "questions.json": JSON.stringify(WAREHOUSE_QUESTIONS),
      "grid.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    };
    for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, f), text);

    const claims: ClaimWire[] = [
      { text: "The forklift went past the entry line", actor: "", object: "forklift", actionKind: "state", stateValue: "past the entry line", timeKind: "approx", t: 7, hedged: false },
      { text: "The pedestrian was inside the crossing", actor: "", object: "pedestrian", actionKind: "state", stateValue: "inside the crossing", timeKind: "none", hedged: false },
      { text: "Someone looked at the forklift", actor: "", object: "forklift", actionKind: "other", verb: "looked at", timeKind: "exact", t: 3, hedged: false },
    ];
    gen.mockResolvedValueOnce({ claims } as never);
    cw.mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.9, contradicts: 0.05, clipId: "real", source: a.source }));

    const transcript = "Around 7 seconds the forklift went past the entry line. The pedestrian was inside the crossing. At 00:03 someone looked at the forklift.";
    const res = await POST(new Request(`http://local/api/scene/${SCENE}/account`, { method: "POST", body: JSON.stringify({ transcript }) }), { params: Promise.resolve({ id: SCENE }) });
    expect(res.status).toBe(200);
    const out = (await res.json()) as ClaimResult[];

    const scene = await loadScene(dir);
    expect(scene.manifest.sceneId).toBe(SCENE);
    expect(scene.claims.map((c) => c.id)).toEqual(out.map((r) => r.claimId));
    expect(scene.results).toEqual(out);
    expect(scene.grid).toHaveLength(rows.length);
    // The board renders claims.map(...) and looks results up by claimId.
    const resultByClaim = new Map(scene.results.map((r) => [r.claimId, r]));
    for (const c of scene.claims) expect(resultByClaim.has(c.id)).toBe(true);
    const labels: Verdict[] = ["Supported", "Contradicted", "Insufficient"];
    for (const r of scene.results) expect(labels).toContain(r.verdict);
    expect(out.map((r) => r.verdict)).toEqual(["Supported", "Supported", "Insufficient"]);
    // Excluded camera C never contributes evidence or an audited clip.
    for (const r of scene.results) for (const e of r.evidence) expect(e.camera).not.toBe("C");
    for (const call of cw.mock.calls) expect(call[0].camera).not.toBe("C");
    // Saved files are the exact on-disk JSON the board reads.
    expect(JSON.parse(await readFile(path.join(dir, "results.json"), "utf8"))).toEqual(out);
  });
});

describe("SDG near-miss scene: account -> board", () => {
  it("grounds natural verb forms to SDG_NEARMISS_QUESTIONS and keeps every safety rule", async () => {
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    const cw = vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow);
    const { SDG_NEARMISS_QUESTIONS } = await import("@/lib/perception/questionSets");
    const { fakeGrid } = await import("@/lib/inference/fake-grid");
    const { saveResult } = await import("@/lib/store/scene");
    const { loadScene } = await import("@/components/loadScene");

    const SDG = "sdg1";
    const dir = path.join(dataDir, "scenes", SDG);
    await mkdir(dir, { recursive: true });
    // The forklift moves until 5 s, then is near the worker; the worker dodges from 5 s. It never touches.
    const rows = fakeGrid({
      sceneId: SDG,
      cameras: ["A", "B", "C"],
      durationS: 10,
      truth: [ev("forklift", "unknown", "moving", 0), ev("forklift", "moving", "near worker", 5), ev("worker", "unknown", "dodging", 5)],
      questions: SDG_NEARMISS_QUESTIONS,
      noise: 0.1,
      sharedErrorRate: 0,
      seed: 5,
    }).map((r) => (r.camera === "C" && r.questionId === "forklift:state:touching_worker" ? { ...r, pYes: 0.97 } : r)); // excluded C falsely "sees" touching
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify({ sceneId: SDG, split: "demo", room: "sdg-warehouse", cameras: ["A", "B", "C"], excludedCameras: ["C"], files: {}, durationS: 10, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
      // Registry ids match the fixed question set (the Dev 1 follow-up this demo needs).
      "entities.json": JSON.stringify([
        { id: "forklift", description: "orange forklift" },
        { id: "worker", description: "warehouse worker" },
        { id: "reach_truck", description: "orange reach truck" },
      ]),
      "people.json": "[]",
      "questions.json": JSON.stringify(SDG_NEARMISS_QUESTIONS),
      "grid.jsonl": rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
    };
    for (const [f, text] of Object.entries(files)) await writeFile(path.join(dir, f), text);

    const st = (text: string, object: string, stateValue: string): ClaimWire => ({ text, actor: "", object, actionKind: "state", stateValue, timeKind: "none", hedged: false });
    const claims: ClaimWire[] = [
      st("The forklift moved toward the worker", "forklift", "moved"),
      st("The forklift came near the worker", "forklift", "near the worker"),
      st("The worker dodged out of the way", "worker", "dodged"),
      st("The forklift hit the worker", "forklift", "hit the worker"),
      st("The forklift was touching the worker", "forklift", "touching the worker"),
      st("The orange thing moved", "orange thing", "moved"),
    ];
    const transcript =
      "The forklift moved toward the worker. The forklift came near the worker. The worker dodged out of the way. " +
      "The forklift hit the worker. The forklift was touching the worker. The orange thing moved.";
    cw.mockImplementation(async (a: CheckWindowArgs): Promise<Evidence> => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.9, contradicts: 0.05, clipId: "real", source: a.source }));
    const run = async () => {
      gen.mockResolvedValueOnce({ claims } as never);
      const res = await POST(new Request(`http://local/api/scene/${SDG}/account`, { method: "POST", body: JSON.stringify({ transcript }) }), { params: Promise.resolve({ id: SDG }) });
      expect(res.status).toBe(200);
      return (await res.json()) as ClaimResult[];
    };

    const out = await run();
    // moved / near / dodged ground and are Supported; "hit" is no question (no synonyms); "touching" is false
    // and only the excluded camera claims it, so it is Insufficient, never Contradicted; "orange thing" is
    // ambiguous (forklift or reach truck) so it is Insufficient with no audit.
    expect(out.map((r) => r.verdict)).toEqual(["Supported", "Supported", "Supported", "Insufficient", "Insufficient", "Insufficient"]);
    expect(out.some((r) => r.verdict === "Contradicted")).toBe(false);
    expect(cw).toHaveBeenCalledTimes(3);
    for (const call of cw.mock.calls) expect(call[0].camera).not.toBe("C");
    for (const r of out) for (const e of r.evidence) expect(e.camera).not.toBe("C");
    for (const i of [3, 4, 5]) expect(out[i]!.audit).toBeNull();

    let scene = await loadScene(dir);
    expect(scene.claims.map((c) => c.id)).toEqual(out.map((r) => r.claimId));
    expect(scene.claims.map((c) => c.window)).toEqual(out.map(() => [0, 10])); // untimed: whole scene
    expect(scene.claims.every((c) => !c.timeIsPrecise)).toBe(true);
    expect(scene.results).toEqual(out);

    // An agent later updates one result; a repeated account must keep it, and the board shows it.
    const updated: ClaimResult = {
      ...out[4]!,
      history: [{ from: "Insufficient", to: "Insufficient", by: "investigator", reason: "checked camera A", at: "2026-11-21T15:00:00.000Z" }],
    };
    await saveResult(SDG, updated);
    const again = await run();
    expect(again[4]).toEqual(updated);
    scene = await loadScene(dir);
    expect(new Map(scene.results.map((r) => [r.claimId, r])).get(updated.claimId)).toEqual(updated);
    expect(scene.results).toHaveLength(6);
  });
});
