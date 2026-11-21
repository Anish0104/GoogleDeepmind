// OWNER: Dev 3. Perceives scenes from the command line, one after another: probe -> perceiveScene() -> stills,
// the same runPipeline() as POST /api/scene/[id]/run. Prints each stage, Dev 1's steps and wall time, and stops
// at the first failure with its stage and error. After each perceived scene it prints scout's entities.json next
// to the entity ids used in questions.json, to show whether they match (e.g. a fixed set's "worker"/"forklift").
// Usage: pnpm perceive <sceneId…>   (loads .env.local; calls Gemini: scout and lattice)
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Question, RunStatus } from "@/lib/types";

// ---------- entity ids: scout's entities.json vs the question set ----------

export interface EntityLike {
  id: string;
  description?: string;
}

export interface EntityComparison {
  entities: EntityLike[];
  questionIds: string[];
  matching: string[];
  /** Asked about in questions.json, but no entity with that id in entities.json. */
  onlyQuestions: string[];
  /** In entities.json, but no question about it. */
  onlyScout: string[];
}

export function compareEntities(entities: EntityLike[], questions: Question[]): EntityComparison {
  const scoutIds = entities.map((e) => e.id);
  const questionIds = [...new Set(questions.map((q) => q.entityId))].sort();
  return {
    entities,
    questionIds,
    matching: questionIds.filter((id) => scoutIds.includes(id)),
    onlyQuestions: questionIds.filter((id) => !scoutIds.includes(id)),
    onlyScout: scoutIds.filter((id) => !questionIds.includes(id)).sort(),
  };
}

export function formatEntityComparison(c: EntityComparison): string {
  const left = (e: EntityLike) => `${e.id}${e.description ? `  (${e.description})` : ""}`;
  const rows: [string, string][] = [
    ...c.matching.map((id): [string, string] => [left(c.entities.find((e) => e.id === id)!), `${id}  ✓`]),
    ...c.onlyScout.map((id): [string, string] => [left(c.entities.find((e) => e.id === id)!), "—"]),
    ...c.onlyQuestions.map((id): [string, string] => ["—", `${id}  ✗ no entity with this id`]),
  ];
  const head: [string, string] = ["entities.json (scout)", "questions.json entity ids"];
  const w = Math.max(head[0].length, ...rows.map((r) => r[0].length));
  const n = c.onlyQuestions.length;
  return [
    `${head[0].padEnd(w)} | ${head[1]}`,
    `${"-".repeat(w)}-|-${"-".repeat(head[1].length)}`,
    ...rows.map(([a, b]) => `${a.padEnd(w)} | ${b}`),
    n === 0
      ? "OK: every question entity id is in entities.json."
      : `MISMATCH: ${n} question entity id${n === 1 ? " has" : "s have"} no entity in entities.json: ${c.onlyQuestions.join(", ")}`,
  ].join("\n");
}

// ---------- running scenes ----------

/** Runs one scene's pipeline, reporting stages (runPipeline) and Dev 1's steps (perceiveScene). */
export type PerceiveRunner = (
  sceneId: string,
  onStage: (stage: string) => void,
  onStep: (step: string, detail: string) => void,
) => Promise<RunStatus>;

export interface PerceiveScenesOptions {
  run: PerceiveRunner;
  log: (line: string) => void;
  /** Milliseconds. */
  clock: () => number;
  /** Called after each perceived scene (the entity comparison). */
  afterScene: (sceneId: string) => Promise<void>;
}

export type PerceiveScenesResult =
  | { ok: true; perceived: string[] }
  | { ok: false; perceived: string[]; failed: { sceneId: string; stage: string; error: string } };

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Perceives scenes one after another; stops at the first one that doesn't end "perceived". */
export async function perceiveScenes(sceneIds: string[], o: PerceiveScenesOptions): Promise<PerceiveScenesResult> {
  const perceived: string[] = [];
  for (const sceneId of sceneIds) {
    const t0 = o.clock();
    const at = () => `+${secs(o.clock() - t0)}`;
    const status = await o.run(
      sceneId,
      (stage) => o.log(`[${sceneId}] ${stage} ${at()}`),
      (step, detail) => o.log(`[${sceneId}]   ${step}: ${detail} ${at()}`),
    );
    if (status.status !== "perceived") {
      const error = status.error ?? `ended with status ${status.status}`;
      o.log(`[${sceneId}] FAILED at stage ${status.stage}: ${error}`);
      return { ok: false, perceived, failed: { sceneId, stage: status.stage, error } };
    }
    o.log(`[${sceneId}] perceived in ${secs(o.clock() - t0)}`);
    perceived.push(sceneId);
    await o.afterScene(sceneId);
  }
  return { ok: true, perceived };
}

// ---------- main ----------

async function main(): Promise<void> {
  // .env.local first: lib/config.ts reads env vars once, when it is first imported (below).
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: pnpm perceive <sceneId…>");
    process.exit(1);
  }
  const { defaultPipelineDeps, runPipeline } = await import("@/lib/pipeline/run");
  const { loadManifest, NotFoundError, scenePath } = await import("@/lib/store/scene");

  const readList = async <T,>(sceneId: string, file: string): Promise<T[]> => {
    try {
      return JSON.parse(await readFile(scenePath(sceneId, file), "utf8")) as T[];
    } catch {
      return [];
    }
  };

  const out = await perceiveScenes(ids, {
    run: async (sceneId, onStage, onStep) => {
      // Like the run route: a missing scene is reported, and nothing is written for it.
      try {
        await loadManifest(sceneId);
      } catch (e) {
        if (!(e instanceof NotFoundError)) throw e;
        return { status: "failed", stage: "probe", startedAt: new Date().toISOString(), error: e.message };
      }
      return runPipeline(sceneId, {
        ...defaultPipelineDeps,
        onStage,
        perceiveScene: (id, opts) =>
          defaultPipelineDeps.perceiveScene(id, {
            ...opts,
            onStep: (step, detail) => {
              onStep(step, detail);
              opts.onStep?.(step, detail);
            },
          }),
      });
    },
    log: (line) => console.log(line),
    clock: () => performance.now(),
    afterScene: async (sceneId) => {
      const c = compareEntities(await readList<EntityLike>(sceneId, "entities.json"), await readList<Question>(sceneId, "questions.json"));
      console.log(`\n[${sceneId}] entity ids\n${formatEntityComparison(c)}\n`);
    },
  });
  if (!out.ok) process.exit(1);
  console.log(`All ${out.perceived.length} scene(s) perceived.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
