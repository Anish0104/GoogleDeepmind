// OWNER: Dev 4. Reads a saved scene folder into one typed object for the board.
// Works for BOTH fixtures/replay/<id>/ and data/scenes/<id>/ — identical file layout
// (section 6 of the plan). No models, no network: this is what makes the demo backup work.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentStep,
  Claim,
  ClaimResult,
  Entity,
  Event,
  GridRow,
  Question,
  SceneManifest,
} from "@/lib/types";

export interface ReplayScene {
  dir: string;
  manifest: SceneManifest;
  claims: Claim[];
  results: ClaimResult[];
  grid: GridRow[];
  events: Event[];
  agentSteps: AgentStep[];
  entities: Entity[];
  questions: Question[];
  /** Sum of every agent step's cost; what the cost meter shows in replay. */
  spentUsd: number;
}

async function readJson<T>(dir: string, file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(dir, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readJsonl<T>(dir: string, file: string): Promise<T[]> {
  try {
    const raw = await readFile(path.join(dir, file), "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Load a scene folder by absolute or repo-relative path. */
export async function loadScene(dir: string): Promise<ReplayScene> {
  const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  const [manifest, claims, results, grid, events, agentSteps, entities, questions] =
    await Promise.all([
      readJson<SceneManifest>(abs, "manifest.json", {
        sceneId: path.basename(abs),
        split: "demo",
        room: "",
        cameras: [],
        excludedCameras: [],
        files: {},
        durationS: 0,
        createdAt: "",
        plannedOcclusion: false,
      }),
      readJson<Claim[]>(abs, "claims.json", []),
      readJson<ClaimResult[]>(abs, "results.json", []),
      readJsonl<GridRow>(abs, "grid.jsonl"),
      readJson<Event[]>(abs, "events.json", []),
      readJsonl<AgentStep>(abs, "agent-steps.jsonl"),
      readJson<Entity[]>(abs, "entities.json", []),
      readJson<Question[]>(abs, "questions.json", []),
    ]);

  const spentUsd = round2(
    agentSteps.reduce((sum, step) => sum + (step.costUsd ?? 0), 0),
  );

  return { dir: abs, manifest, claims, results, grid, events, agentSteps, entities, questions, spentUsd };
}
