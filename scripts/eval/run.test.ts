// OWNER: Dev 3. Scene cloning, case generation and the eval run, with fake account/agent steps (no Gemini).
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Claim, ClaimResult, SceneManifest, Verdict } from "@/lib/types";
import type { EvalCase } from "@/scripts/eval/accounts";
import { cloneScene } from "@/scripts/eval/clone";
import { genAccounts } from "@/scripts/eval/gen-accounts";
import { runWarehouse, type WarehouseDeps } from "@/scripts/eval/run-warehouse";
import { fakeTruth } from "@/scripts/eval/fixtures";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rashomon-wh-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const manifest = (sceneId: string, excludedCameras: SceneManifest["excludedCameras"] = []): SceneManifest => ({
  sceneId,
  split: "dev",
  room: "warehouse",
  cameras: ["A", "B", "C", "D"],
  excludedCameras,
  files: { A: "cam-A.webm" },
  durationS: 10,
  createdAt: "2026-11-21T15:00:00.000Z",
  plannedOcclusion: false,
  presynced: true,
  questionSet: "warehouse",
});

async function writeScene(sceneId: string, excluded: SceneManifest["excludedCameras"] = []) {
  const s = path.join(dir, "scenes", sceneId);
  await mkdir(path.join(s, "stills", "cam-A"), { recursive: true });
  await writeFile(path.join(s, "manifest.json"), JSON.stringify(manifest(sceneId, excluded)));
  await writeFile(
    path.join(s, "grid.jsonl"),
    [0, 0.5].map((t) => JSON.stringify({ sceneId, camera: "A", t, questionId: "worker:visible:yes", pYes: 0.9, pVisible: 0.9 })).join("\n") + "\n",
  );
  await writeFile(path.join(s, "questions.json"), "[]");
  await writeFile(path.join(s, "entities.json"), "[]");
  await writeFile(path.join(s, "cam-A.webm"), "video bytes");
  await writeFile(path.join(s, "stills", "cam-A", "00001.jpg"), "jpg");
  await writeFile(path.join(s, "results.json"), "[]"); // an earlier run's output: not cloned
  await writeFile(path.join(s, "claims.json"), "[]");
  await writeFile(path.join(s, "agent-steps.jsonl"), "");
  await writeFile(path.join(s, "run.json"), "{}");
}

describe("cloneScene", () => {
  it("copies perception outputs with the new sceneId, links media, and leaves earlier outputs behind", async () => {
    await writeScene("wh1");
    await cloneScene("wh1", "wh1__true", dir);
    const c = path.join(dir, "scenes", "wh1__true");

    expect(JSON.parse(await readFile(path.join(c, "manifest.json"), "utf8"))).toMatchObject({ sceneId: "wh1__true", presynced: true });
    const rows = (await readFile(path.join(c, "grid.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.map((r) => r.sceneId)).toEqual(["wh1__true", "wh1__true"]);
    expect(await readFile(path.join(c, "questions.json"), "utf8")).toBe("[]");
    for (const f of ["results.json", "claims.json", "agent-steps.jsonl", "run.json"]) {
      await expect(lstat(path.join(c, f))).rejects.toThrow(/ENOENT/);
    }
    expect((await lstat(path.join(c, "cam-A.webm"))).isSymbolicLink()).toBe(true);
    expect(await readlink(path.join(c, "stills"))).toBe(path.join(dir, "scenes", "wh1", "stills"));
    expect(await readFile(path.join(c, "stills", "cam-A", "00001.jpg"), "utf8")).toBe("jpg");
  });

  it("re-cloning replaces the previous clone (no stale results)", async () => {
    await writeScene("wh1");
    await cloneScene("wh1", "wh1__true", dir);
    await writeFile(path.join(dir, "scenes", "wh1__true", "results.json"), "[1]");
    await cloneScene("wh1", "wh1__true", dir);
    await expect(lstat(path.join(dir, "scenes", "wh1__true", "results.json"))).rejects.toThrow(/ENOENT/);
  });

  it("refuses unsafe ids and a missing source scene", async () => {
    await expect(cloneScene("../x", "y", dir)).rejects.toThrow(/Invalid scene id/);
    await expect(cloneScene("nope", "nope__true", dir)).rejects.toThrow(/not found/);
  });
});

describe("genAccounts", () => {
  it("reads the answer key and the manifest (excluded cameras), writes data/eval/cases/<sceneId>.json", async () => {
    await writeScene("wh1", ["D"]);
    await mkdir(path.join(dir, "labels"));
    const truth = fakeTruth({ sceneId: "wh1", outcome: "near_miss", minGapT: 6.1, forkliftStopT: 5.5, hidden: [5, 7.2], hiddenFrom: ["A", "B", "C"] });
    await writeFile(path.join(dir, "labels", "wh1.truth.json"), JSON.stringify(truth));

    const [file] = await genAccounts(["wh1"], { dataDir: dir });
    expect(file).toBe(path.join(dir, "eval", "cases", "wh1.json"));
    const c = JSON.parse(await readFile(file!, "utf8")) as EvalCase;
    expect(c.includedCameras).toEqual(["A", "B", "C"]);
    expect(c.accounts.map((a) => a.name)).toEqual(["true", "mixed"]);
    // D is excluded, and only D saw the worker around the closest approach: those statements can't be decided.
    expect(c.accounts[0]!.statements.find((s) => s.kind === "contact")!.expected).toBe("Insufficient");
    // Deterministic: a second run writes the same file.
    const again = await genAccounts(["wh1"], { dataDir: dir });
    expect(await readFile(again[0]!, "utf8")).toBe(await readFile(file!, "utf8"));
  });
});

describe("runWarehouse", () => {
  it("per account: clone, runAccount, agents; scores claims before vs after; writes the report", async () => {
    await writeScene("wh1");
    await mkdir(path.join(dir, "labels"));
    const truth = fakeTruth({ sceneId: "wh1", outcome: "contact", contact: [3.167, 3.467], minGapT: 3.233, dodgeStartT: 2.3 });
    await writeFile(path.join(dir, "labels", "wh1.truth.json"), JSON.stringify(truth));
    await genAccounts(["wh1"], { dataDir: dir });

    // Fakes: the account labels every claim Insufficient; the agents settle every claim to what it says is true.
    const claimsBy = new Map<string, Claim[]>();
    const resultsBy = new Map<string, ClaimResult[]>();
    const calls: string[] = [];
    const deps: WarehouseDeps = {
      clone: (src, dst) => {
        calls.push(`clone ${src} -> ${dst}`);
        return cloneScene(src, dst, dir);
      },
      runAccount: async (sceneId, transcript) => {
        calls.push(`account ${sceneId}`);
        const claims = transcript.split(/(?<=\.)\s+/).map((text, i): Claim => ({ id: `c${i}`, sceneId, text, actor: "speaker", object: "forklift", action: "x", window: [2, 4], timeIsPrecise: true }));
        claimsBy.set(sceneId, claims);
        const results = claims.map((c): ClaimResult => ({ claimId: c.id, verdict: "Insufficient", evidence: [], audit: null, history: [] }));
        resultsBy.set(sceneId, results);
        return results;
      },
      runAgents: async (sceneId) => {
        calls.push(`agents ${sceneId}`);
        const c = JSON.parse(await readFile(path.join(dir, "eval", "cases", "wh1.json"), "utf8")) as EvalCase;
        const account = c.accounts.find((a) => sceneId.endsWith(`__${a.name}`))!;
        resultsBy.set(sceneId, resultsBy.get(sceneId)!.map((r, i) => ({ ...r, verdict: (account.statements[i]!.truth ? "Supported" : "Contradicted") as Verdict })));
        return { status: 200, body: {} };
      },
      loadClaims: async (sceneId) => claimsBy.get(sceneId) ?? [],
      loadResults: async (sceneId) => resultsBy.get(sceneId) ?? [],
    };

    const report = await runWarehouse(["wh1"], { dataDir: dir, deps, now: () => new Date("2026-11-21T20:00:00.000Z"), agentMode: "standin" });

    expect(calls).toEqual(["clone wh1 -> wh1__true", "account wh1__true", "agents wh1__true", "clone wh1 -> wh1__mixed", "account wh1__mixed", "agents wh1__mixed"]);
    const rows = report.scenes[0]!.accounts.flatMap((a) => a.rows);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.before === "Insufficient" && r.outcomeBefore === "coverage-loss")).toBe(true);
    expect(rows.every((r) => r.outcome === "correct")).toBe(true);

    const md = await readFile(path.join(dir, "eval", "results", "warehouse-eval.md"), "utf8");
    expect(md).toMatch(/Critical errors \(target 0\) \| 0 of 10/);
    expect(JSON.parse(await readFile(path.join(dir, "eval", "results", "warehouse-eval.json"), "utf8")).scenes).toHaveLength(1);
  });

  it("an account that fails (e.g. budget) is reported, not scored; the run continues", async () => {
    await writeScene("wh1");
    await mkdir(path.join(dir, "labels"));
    await writeFile(path.join(dir, "labels", "wh1.truth.json"), JSON.stringify(fakeTruth({ sceneId: "wh1", outcome: "contact", contact: [3, 3.3], minGapT: 3.1 })));
    await genAccounts(["wh1"], { dataDir: dir });
    const deps: WarehouseDeps = {
      clone: (src, dst) => cloneScene(src, dst, dir),
      runAccount: async () => {
        throw Object.assign(new Error("Budget hard stop reached"), { status: 429 });
      },
      runAgents: async () => ({ status: 200, body: {} }),
      loadClaims: async () => [],
      loadResults: async () => [],
    };
    const report = await runWarehouse(["wh1"], { dataDir: dir, deps, agentMode: "standin" });
    expect(report.scenes[0]!.accounts.map((a) => a.error)).toEqual(["account: Budget hard stop reached", "account: Budget hard stop reached"]);
  });
});
