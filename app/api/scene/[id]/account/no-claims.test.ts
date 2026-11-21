// OWNER: Dev 2. A statement with no verifiable claim is an error (422 with the rejection reasons), never an empty
// account: nothing is written, so stored claims/results stay as they were and agents are never started on [].
// Carbon is mocked; everything else is real.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimWire } from "@/lib/truth/claims";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/agent/start", () => ({ startAgent: vi.fn(async () => ({ ran: false, reason: "mocked agent" })) }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

const { dataDir, prevDataDir } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const prev = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), "rashomon-noclaims-"));
  process.env.DATA_DIR = dir;
  return { dataDir: dir, prevDataDir: prev };
});
let n = 0;
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

async function scene(extra: Record<string, string> = {}) {
  const id = `noclaims${++n}`;
  const dir = path.join(dataDir, "scenes", id);
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ sceneId: id, split: "demo", room: "t", cameras: ["A"], excludedCameras: [], files: {}, durationS: 10, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
    "entities.json": JSON.stringify([{ id: "forklift", description: "forklift" }]),
    "people.json": JSON.stringify([{ id: "worker", description: "the worker" }]),
    "questions.json": JSON.stringify([{ id: "forklift:state:moving", entityId: "forklift", predicate: "state", value: "moving", text: "moving?" }]),
    "grid.jsonl": "",
    ...extra,
  };
  for (const [f, t] of Object.entries(files)) await writeFile(path.join(dir, f), t);
  return { id, dir };
}

async function post(id: string, claims: ClaimWire[], transcript: string) {
  const { POST } = await import("@/app/api/scene/[id]/account/route");
  vi.mocked((await import("@/lib/gemini/client")).generateJson).mockResolvedValueOnce({ claims } as never);
  return POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript }) }), { params: Promise.resolve({ id }) });
}

// The model invents a claim that is not in the statement: rejected by the fidelity check.
const INVENTED: ClaimWire = { text: "The forklift exploded", actor: "", object: "forklift", actionKind: "state", stateValue: "exploded", timeKind: "none", hedged: false };

describe("account with no verifiable claim", () => {
  it("is 422 with the rejection reason and writes no claims.json", async () => {
    const { id, dir } = await scene();
    const res = await post(id, [INVENTED], "Something happened near the racks.");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("claims_rejected");
    expect(body.error).toMatch(/none passed validation.*rejected: #1: object "forklift" is not in the transcript/);
    await expect(readFile(path.join(dir, "claims.json"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(dir, "results.json"), "utf8")).rejects.toThrow();
  });

  it("the model proposing none is also 422, and earlier claims/results are left untouched", async () => {
    const prevClaims = JSON.stringify([{ id: "x", sceneId: "s", text: "t", actor: "", object: "forklift", action: "state moving", window: [0, 10], timeIsPrecise: false }]);
    const { id, dir } = await scene({ "claims.json": prevClaims, "results.json": "[]" });
    const res = await post(id, [], "Something happened near the racks.");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("no_claims_proposed");
    expect(body.error).toMatch(/proposed none/);
    expect(await readFile(path.join(dir, "claims.json"), "utf8")).toBe(prevClaims);
  });

  it.each(["dfdfd", "asdf", "   ", "?!...", "xkcd zzzz"])("rejects %j before any model call (not_a_statement)", async (t) => {
    const { id, dir } = await scene();
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    gen.mockReset();
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const res = await POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript: t }) }), { params: Promise.resolve({ id }) });
    expect([400, 422]).toContain(res.status);
    if (res.status === 422) expect(((await res.json()) as { code: string }).code).toBe("not_a_statement");
    expect(gen).not.toHaveBeenCalled();
    await expect(readFile(path.join(dir, "claims.json"), "utf8")).rejects.toThrow();
  });

  it("malformed model output twice is model_output_invalid (502), after exactly 2 calls, and writes nothing", async () => {
    const { id, dir } = await scene();
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    gen.mockReset();
    gen.mockRejectedValue(new Error("[claims] model returned non-JSON output: oops"));
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const res = await POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript: "The forklift stopped." }) }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("model_output_invalid");
    expect(gen).toHaveBeenCalledTimes(2);
    await expect(readFile(path.join(dir, "claims.json"), "utf8")).rejects.toThrow();
  });

  it("a model/API failure is model_unavailable (502) with no extra retry here", async () => {
    const { id } = await scene();
    const gen = vi.mocked((await import("@/lib/gemini/client")).generateJson);
    gen.mockReset();
    gen.mockRejectedValue(Object.assign(new Error("quota"), { status: 403 }));
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    const res = await POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript: "The forklift stopped." }) }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe("model_unavailable");
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("a successful account saves claims and results; then agents start (200, not 404) on the saved claims", async () => {
    const { id, dir } = await scene();
    const T = "The forklift was moving at about 4 seconds. The forklift did not touch the worker.";
    const res = await post(
      id,
      [
        { text: "The forklift was moving at about 4 seconds", actor: "", object: "forklift", actionKind: "state", stateValue: "moving", timeKind: "approx", t: 4, hedged: false },
        { text: "The forklift did not touch the worker", actor: "", object: "forklift", actionKind: "state", stateValue: "touch the worker", timeKind: "none", hedged: false },
      ],
      T,
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { claimId: string }[];
    expect(out).toHaveLength(2);
    const claims = JSON.parse(await readFile(path.join(dir, "claims.json"), "utf8")) as { id: string; text: string; window: number[] }[];
    expect(claims.map((c) => c.text)).toEqual(["The forklift was moving at about 4 seconds", "The forklift did not touch the worker"]);
    expect(claims[0]!.window).toEqual([1, 7]); // approx 4 s
    expect(claims[1]!.window).toEqual([0, 10]); // no time: the whole scene, never invented
    const saved = JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as { claimId: string }[];
    expect(saved.map((r) => r.claimId).sort()).toEqual(claims.map((c) => c.id).sort());

    const { POST } = await import("@/app/api/scene/[id]/agents/route");
    const ag = await POST(new Request(`http://local/api/scene/${id}/agents`, { method: "POST" }), { params: Promise.resolve({ id }) });
    expect(ag.status).toBe(200);
    expect(((await ag.json()) as { claims: unknown[] }).claims).toHaveLength(2);
  });

  it("then the agents endpoint still reports that there are no claims (404), never a run on []", async () => {
    const { id } = await scene();
    await post(id, [], "Something happened.");
    const { POST } = await import("@/app/api/scene/[id]/agents/route");
    const res = await POST(new Request(`http://local/api/scene/${id}/agents`, { method: "POST" }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
  });
});
