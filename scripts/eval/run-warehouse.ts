// OWNER: Dev 3. Runs the warehouse eval. For each scene's case (data/eval/cases/<sceneId>.json, from
// gen-accounts.ts) and each account ("true", "mixed"):
//   1. clone the perceived scene to <sceneId>__<account> (perception outputs copied, no re-perception);
//   2. Dev 2's runAccount() on the clone: transcript -> claims -> labels (the "before agents" labels);
//   3. our agents handler (POST /api/scene/[id]/agents logic; respects AGENT_MODE);
//   4. score every statement against the answer key, before and after agents.
// Writes data/eval/results/warehouse-eval.{json,md}; `pnpm tsx scripts/eval/run-warehouse.ts --doc` also copies
// the markdown to docs/proof/warehouse-eval.md. Usage: pnpm tsx scripts/eval/run-warehouse.ts [--doc] <sceneId…>
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "@/lib/config";
import type { Claim, ClaimResult } from "@/lib/types";
import type { EvalCase } from "@/scripts/eval/accounts";
import { cloneScene } from "@/scripts/eval/clone";
import { casePath } from "@/scripts/eval/gen-accounts";
import { formatMarkdown, scoreAccount, type ClaimLabel, type ScoredAccount, type WarehouseReport } from "@/scripts/eval/score";

export interface WarehouseDeps {
  clone: (sceneId: string, cloneId: string) => Promise<void>;
  /** Dev 2's runAccount(): returns one result per extracted claim (the labels before agents). */
  runAccount: (sceneId: string, transcript: string) => Promise<ClaimResult[]>;
  /** Our agents handler; 200 when it ran. */
  runAgents: (sceneId: string) => Promise<{ status: number; body: unknown }>;
  loadClaims: (sceneId: string) => Promise<Claim[]>;
  loadResults: (sceneId: string) => Promise<ClaimResult[]>;
}

export interface WarehouseOptions {
  dataDir?: string;
  deps?: WarehouseDeps;
  now?: () => Date;
  agentMode?: string;
}

/** The real steps. Imported lazily so a test can run without loading the model clients. */
async function realDeps(dataDir: string): Promise<WarehouseDeps> {
  const [{ runAccount }, { handleAgentsRun }, { loadClaims }, { loadResults }] = await Promise.all([
    import("@/lib/truth/account"),
    import("@/lib/api/handlers"),
    import("@/lib/pipeline/run"),
    import("@/lib/store/scene"),
  ]);
  return {
    clone: (src, dst) => cloneScene(src, dst, dataDir),
    runAccount: (sceneId, transcript) => runAccount(sceneId, transcript),
    runAgents: (sceneId) => handleAgentsRun(sceneId),
    loadClaims,
    loadResults,
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runWarehouse(sceneIds: string[], opts: WarehouseOptions = {}): Promise<WarehouseReport> {
  const dataDir = opts.dataDir ?? DATA_DIR;
  const deps = opts.deps ?? (await realDeps(dataDir));
  const report: WarehouseReport = {
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    agentMode: opts.agentMode ?? process.env.AGENT_MODE ?? "standin",
    scenes: [],
  };

  for (const sceneId of sceneIds) {
    const c = JSON.parse(await readFile(casePath(sceneId, dataDir), "utf8")) as EvalCase;
    const accounts: WarehouseReport["scenes"][number]["accounts"] = [];
    for (const account of c.accounts) {
      const cloneId = `${sceneId}__${account.name}`;
      const fail = (error: string): ScoredAccount & { name: string } => ({ name: account.name, rows: [], extraClaims: [], error });
      await deps.clone(sceneId, cloneId);

      let before: ClaimResult[];
      try {
        before = await deps.runAccount(cloneId, account.transcript);
      } catch (e) {
        accounts.push(fail(`account: ${errText(e)}`));
        continue;
      }
      const agents = await deps.runAgents(cloneId);
      if (agents.status !== 200) {
        accounts.push(fail(`agents: ${agents.status} ${JSON.stringify(agents.body)}`));
        continue;
      }

      const claims = await deps.loadClaims(cloneId);
      const beforeBy = new Map(before.map((r) => [r.claimId, r.verdict]));
      const afterBy = new Map((await deps.loadResults(cloneId)).map((r) => [r.claimId, r.verdict]));
      const labels: ClaimLabel[] = claims
        .filter((cl) => beforeBy.has(cl.id) || afterBy.has(cl.id))
        .map((cl) => ({
          claimId: cl.id,
          text: cl.text,
          before: (beforeBy.get(cl.id) ?? afterBy.get(cl.id))!,
          after: (afterBy.get(cl.id) ?? beforeBy.get(cl.id))!,
        }));
      accounts.push({ name: account.name, ...scoreAccount(sceneId, account, labels) });
    }
    report.scenes.push({ sceneId, accounts });
  }

  const outDir = path.resolve(dataDir, "eval", "results");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "warehouse-eval.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(outDir, "warehouse-eval.md"), formatMarkdown(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith("--"));
  if (ids.length === 0) {
    console.error("Usage: pnpm tsx scripts/eval/run-warehouse.ts [--doc] <sceneId…>");
    process.exit(1);
  }
  const report = await runWarehouse(ids);
  const md = path.resolve(DATA_DIR, "eval", "results", "warehouse-eval.md");
  console.log(formatMarkdown(report));
  if (args.includes("--doc")) {
    await copyFile(md, path.join(process.cwd(), "docs", "proof", "warehouse-eval.md"));
    console.log("\ncopied to docs/proof/warehouse-eval.md");
  }
}
