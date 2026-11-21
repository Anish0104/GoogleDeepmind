// OWNER: Dev 2. Persistence regression on REAL saved perception data: the confirmed-contact NVIDIA SDG scene
// sdg_nm_523198994 (grid excerpt in lib/truth/fixtures/sdgContactGrid.ts; its answer key is not used).
// Only the paid model boundaries are mocked: Carbon (claim extraction) and Decision 1 (checkWindow), which
// here confirms whatever it is asked, the worst case for a false Supported. QUESTION_SET_EXCLUSIVE is the
// real one from main (sdg-nearmiss registers no pairs).
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Claim, ClaimResult, Evidence, Question } from "@/lib/types";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { ClaimWire } from "@/lib/truth/claims";
import { CONTACT_QUESTION_IDS, CONTACT_ROWS, CONTACT_SCENE_ID } from "@/lib/truth/fixtures/sdgContactGrid";

vi.mock("@/lib/gemini/client", () => ({ generateJson: vi.fn(), decide: vi.fn() }));
vi.mock("@/lib/perception/checkWindow", () => ({ checkWindow: vi.fn() }));
vi.mock("@/lib/cost", async (orig) => ({ ...(await orig<typeof import("@/lib/cost")>()), assertBudget: vi.fn(async () => undefined) }));

const { dataDir, prevDataDir } = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const p = require("node:path") as typeof import("node:path");
  const prev = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), "rashomon-persist-"));
  process.env.DATA_DIR = dir;
  return { dataDir: dir, prevDataDir: prev };
});
beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await rm(dataDir, { recursive: true, force: true });
});

const VALUES: Record<string, string> = {
  "forklift:state:touching_worker": "touching worker",
  "forklift:state:clear_of_worker": "clear of worker",
  "forklift:state:moving": "moving",
  "forklift:state:stopped": "stopped",
  "forklift:state:near_worker": "near worker",
  "worker:state:dodging": "dodging",
};
const QS: Question[] = CONTACT_QUESTION_IDS.map((id) => ({ id, entityId: id.split(":")[0]!, predicate: "state", value: VALUES[id]!, text: `${VALUES[id]}?` }));

async function scene() {
  const id = CONTACT_SCENE_ID;
  const dir = path.join(dataDir, "scenes", id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const grid = CONTACT_ROWS.map(([camera, t, qi, pYes, pVisible]) => JSON.stringify({ sceneId: id, camera, t, questionId: CONTACT_QUESTION_IDS[qi], pYes, pVisible }));
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify({ sceneId: id, split: "dev", room: "sdg-warehouse", cameras: ["A", "B", "C", "D"], excludedCameras: [], files: {}, durationS: 10, createdAt: "2026-11-21T20:05:07.738Z", plannedOcclusion: false }),
    "entities.json": JSON.stringify([{ id: "worker", description: "the worker on the warehouse floor" }, { id: "forklift", description: "stand-up warehouse forklift" }]),
    "people.json": JSON.stringify([{ id: "worker", description: "the worker on the warehouse floor" }]),
    "questions.json": JSON.stringify(QS),
    "grid.jsonl": grid.join("\n") + "\n",
  };
  for (const [f, t] of Object.entries(files)) await writeFile(path.join(dir, f), t);
  return { id, dir };
}

const st = (text: string, stateValue: string, o: Partial<ClaimWire> = {}): ClaimWire => ({ text, actor: "", object: "forklift", actionKind: "state", stateValue, timeKind: "none", hedged: false, ...o });
const CLAIMS = [
  st("The forklift stayed clear of the worker", "clear of the worker"),
  st("The forklift remained stopped throughout", "stopped"),
  st("The forklift was clear of the worker at 4 seconds", "clear of the worker", { timeKind: "exact", t: 4 }),
  st("The forklift was moving", "moving"),
  st("The forklift never touched the worker", "touched the worker"),
  st("The forklift stopped before reaching the worker", "stopped"),
  st("The forklift was clear of the worker", "clear of the worker"),
];
const TRANSCRIPT = CLAIMS.map((c) => c.text + ".").join(" ");
/** Decision 1 stand-in that confirms every clip it is shown: the worst case for a false Supported. */
const confirmEverything = async (a: CheckWindowArgs): Promise<Evidence> => ({ camera: a.camera, window: a.window, visible: 0.9, supports: 0.95, contradicts: 0.03, clipId: "clip", source: a.source });

describe("persistence claims on the real confirmed-contact grid", () => {
  it("'stayed clear' is never Supported: kept in claims.json, Insufficient, not audited", async () => {
    const { id, dir } = await scene();
    const { POST } = await import("@/app/api/scene/[id]/account/route");
    vi.mocked((await import("@/lib/gemini/client")).generateJson).mockResolvedValueOnce({ claims: CLAIMS } as never);
    const cw = vi.mocked((await import("@/lib/perception/checkWindow")).checkWindow);
    cw.mockReset();
    cw.mockImplementation(confirmEverything);

    const res = await POST(new Request(`http://local/api/scene/${id}/account`, { method: "POST", body: JSON.stringify({ transcript: TRANSCRIPT }) }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const out = (await res.json()) as ClaimResult[];
    const claims = JSON.parse(await readFile(path.join(dir, "claims.json"), "utf8")) as Claim[];
    const saved = JSON.parse(await readFile(path.join(dir, "results.json"), "utf8")) as ClaimResult[];

    // Nothing is silently dropped: every extracted claim is in claims.json and has a saved result.
    expect(claims.map((c) => c.text)).toEqual(CLAIMS.map((c) => c.text));
    expect(out.map((r) => r.claimId)).toEqual(claims.map((c) => c.id));
    expect(saved.map((r) => r.claimId).sort()).toEqual(claims.map((c) => c.id).sort());

    const by = (text: string) => out[claims.findIndex((c) => c.text === text)]!;
    const audited = new Set(cw.mock.calls.map((x) => x[0].claim.text));
    for (const text of ["The forklift stayed clear of the worker", "The forklift remained stopped throughout", "The forklift never touched the worker", "The forklift stopped before reaching the worker"]) {
      expect(by(text).verdict).toBe("Insufficient");
      expect(by(text).audit).toBeNull();
      expect(audited.has(text)).toBe(false);
    }

    // The same real evidence DOES support the point-in-time form (the forklift really was clear before the
    // contact), which is exactly why the persistence form must not be graded on it.
    expect(audited.has("The forklift was clear of the worker")).toBe(true);
    expect(by("The forklift was clear of the worker").verdict).toBe("Supported");

    // Ordinary claims are graded as before: grounded, audited when the evidence reaches CLEAR, labelled by verdict().
    const { verdict } = await import("@/lib/inference/verdict");
    for (const text of ["The forklift was clear of the worker at 4 seconds", "The forklift was moving"]) {
      const r = by(text);
      const c = claims.find((x) => x.text === text)!;
      expect(r.evidence.some((e) => e.supports !== null)).toBe(true);
      expect(r.verdict).toBe(verdict(r.evidence, c, r.audit));
    }
    expect(audited.has("The forklift was moving")).toBe(true);
    expect(by("The forklift was moving").verdict).toBe("Supported");

    // With no registered pairs (main), nothing on this grid can be Contradicted.
    expect(out.some((r) => r.verdict === "Contradicted")).toBe(false);
  });
});
