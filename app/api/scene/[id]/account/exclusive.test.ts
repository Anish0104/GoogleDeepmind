// OWNER: Dev 2. The generic exclusive-state mechanism through the real account route, for a question set
// that DOES register pairs. QUESTION_SET_EXCLUSIVE is mocked with a HYPOTHETICAL fixture (sdg-nearmiss on
// main registers none); Carbon, checkWindow() and the budget guard are mocked; everything else is real.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/lib/config";
import type { CameraId, ClaimResult, Evidence, GridRow, Question } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";

const PAIRS: [string, string][] = [
  ["forklift:state:moving", "forklift:state:stopped"],
  ["forklift:state:touching_worker", "forklift:state:clear_of_worker"],
];
vi.mock("@/lib/perception/questionSets", async (orig) => ({ ...(await orig<object>()), QUESTION_SET_EXCLUSIVE: { "sdg-nearmiss": PAIRS } }));
vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

const q = (entityId: string, predicate: Question["predicate"], value: string): Question => ({ id: `${entityId}:${predicate}:${value.replace(/\s+/g, "_")}`, entityId, predicate, value, text: `${value}?` });
const QS: Question[] = [
  q("worker", "visible", "yes"),
  q("forklift", "visible", "yes"),
  q("forklift", "state", "near worker"),
  q("forklift", "state", "touching worker"),
  q("forklift", "state", "clear of worker"),
  q("forklift", "state", "moving"),
  q("forklift", "state", "stopped"),
  q("worker", "state", "dodging"),
];

// DATA_DIR must be set before lib/config.ts first loads (this file imports it at the top), so it is
// created in vi.hoisted(), which runs before any import.
const { dataDir, prevDataDir } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const prev = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), "rashomon-excl-"));
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

/** Rows over [0, 10) for each camera: the forklift moves the whole time and stays clear of the worker. */
function rows(sceneId: string, cams: CameraId[], pVisible: Partial<Record<CameraId, number>> = {}): GridRow[] {
  const vals: Record<string, number> = {
    "forklift:state:moving": 0.96,
    "forklift:state:stopped": 0.03,
    "forklift:state:touching_worker": 0.03,
    "forklift:state:clear_of_worker": 0.96,
    "forklift:state:near_worker": 0.9,
    "worker:state:dodging": 0.1,
  };
  const out: GridRow[] = [];
  for (const camera of cams)
    for (let t = 0; t < 10 - 1e-9; t += LIMITS.SLICE_S)
      for (const [questionId, pYes] of Object.entries(vals)) out.push({ sceneId, camera, t, questionId, pYes, pVisible: pVisible[camera] ?? 0.93 });
  return out;
}

async function scene(o: { excluded?: CameraId[]; pVisible?: Partial<Record<CameraId, number>> } = {}) {
  const id = `excl${++n}`;
  const dir = path.join(dataDir, "scenes", id);
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ sceneId: id, split: "dev", room: "test", cameras: ["A", "B"], excludedCameras: o.excluded ?? [], files: {}, durationS: 10, createdAt: "2026-11-21T00:00:00.000Z", plannedOcclusion: false }),
    "entities.json": JSON.stringify([{ id: "worker", description: "worker on the warehouse floor" }, { id: "forklift", description: "stand-up warehouse forklift" }]),
    "people.json": JSON.stringify([{ id: "worker", description: "the worker" }]),
    "questions.json": JSON.stringify(QS),
    "grid.jsonl": rows(id, ["A", "B"], o.pVisible).map((r) => JSON.stringify(r)).join("\n") + "\n",
  };
  for (const [f, t] of Object.entries(files)) await writeFile(path.join(dir, f), t);
  return id;
}

const st = (text: string, stateValue: string, o: Partial<ClaimWire> = {}): ClaimWire => ({ text, actor: "", object: "forklift", actionKind: "state", stateValue, timeKind: "approx", t: 3, hedged: false, ...o });
const TRANSCRIPT =
  "The forklift touched the worker at about 3 seconds. The forklift was stopped at about 3 seconds. " +
  "The forklift was moving at about 3 seconds. The forklift never touched the worker at about 3 seconds.";
const CLAIMS = [
  st("The forklift touched the worker at about 3 seconds", "touched the worker"),
  st("The forklift was stopped at about 3 seconds", "stopped"),
  st("The forklift was moving at about 3 seconds", "moving"),
  st("The forklift never touched the worker at about 3 seconds", "touched the worker"),
];

async function run(id: string, audit: (a: CheckWindowArgs) => Promise<Evidence>) {
  const { POST } = await import("@/app/api/scene/[id]/account/route");
  vi.mocked((await import("@/lib/gemini/client")).generateJson).mockResolvedValueOnce({ claims: CLAIMS } as never);
  const cw = vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow);
  cw.mockReset();
  cw.mockImplementation(audit);
  const res = await POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript: TRANSCRIPT }) }), { params: Promise.resolve({ id }) });
  expect(res.status).toBe(200);
  return { out: (await res.json()) as ClaimResult[], cw };
}
/** Simulated Decision 1 consistent with the rows: the forklift was moving and clear of the worker. */
const honest = async (a: CheckWindowArgs): Promise<Evidence> => {
  const t = a.claim.text;
  const falseClaim = /touched|stopped/.test(t);
  return { camera: a.camera, window: a.window, visible: 0.9, supports: falseClaim ? 0.03 : 0.93, contradicts: falseClaim ? 0.95 : 0.03, clipId: "clip", source: a.source };
};

describe("exclusive states through the account route", () => {
  it("registered opposites seen throughout contradict; the plain state is supported; negation is not graded", async () => {
    const { out, cw } = await run(await scene(), honest);
    expect(out.map((r) => r.verdict)).toEqual(["Contradicted", "Contradicted", "Supported", "Insufficient"]);
    expect(out[3]!.audit).toBeNull(); // negated claim: no audit
    expect(cw).toHaveBeenCalledTimes(3);
    for (const call of cw.mock.calls) {
      expect(call[0].window[0]).toBeGreaterThanOrEqual(0);
      expect(call[0].window[1]).toBeLessThanOrEqual(6);
      expect(call[0].window[1] - call[0].window[0]).toBeLessThanOrEqual(4);
    }
  });

  it("a failed independent audit leaves the contradiction unlabelled", async () => {
    const { out } = await run(await scene(), async () => {
      throw new Error("ffmpeg exited 1");
    });
    expect(out.map((r) => r.verdict)).toEqual(["Insufficient", "Insufficient", "Insufficient", "Insufficient"]);
  });

  it("an audit that does not confirm the contradiction leaves it Insufficient", async () => {
    const { out } = await run(await scene(), async (a) => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.3, contradicts: 0.6, clipId: "c", source: a.source }));
    expect(out[0]!.verdict).toBe("Insufficient");
    expect(out[1]!.verdict).toBe("Insufficient");
  });

  it("only an excluded camera seeing the opposite cannot contradict", async () => {
    const { out, cw } = await run(await scene({ excluded: ["B"], pVisible: { A: 0.3 } }), honest);
    expect(out.every((r) => r.verdict === "Insufficient")).toBe(true);
    for (const r of out) for (const e of r.evidence) expect(e.camera).not.toBe("B");
    expect(cw).not.toHaveBeenCalled();
  });
});
