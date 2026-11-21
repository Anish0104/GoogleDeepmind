// OWNER: Dev 3. The scene pipeline. Every stage is injected (same pattern as runAgent), so tests use fakes;
// the defaults call each dev's real function exactly as it is.
//
// Order: claims -> probe -> perceive (Dev 1's perceiveScene(): sync -> slice -> scout -> lattice) -> per claim
// (evidence -> pickCitation -> audit -> verdict -> saveResult) -> stills.json -> agents.
// - claims.json is written by Dev 2's account route; missing or empty fails stage "claims" before any work.
// - probe records each included camera's recording (as a path relative to the scene folder) and the shortest
//   duration into manifest.json. Stored files are resolved through scenePath before any stage reads them.
// - Excluded cameras are never probed, and their grid rows and evidence are dropped before any label work.
// - assertBudget() runs before every Gemini-calling stage (perceive, each audit, agents); a budget stop is a
//   clean failed status with error "budget". perceiveScene() runs scout and lattice in one call, so the
//   budget is checked once before it, not between Dev 1's steps.
// - perceiveScene() returns counts only: this run's grid rows come from its onRows callback (grid.jsonl is
//   appended to, so rereading it would double rows on a rerun); questions.json and slices.json are read back
//   from the store (scout and slice overwrite them each run).
// - Progress goes to data/scenes/<id>/run.json. A failed stage records its name and message; results
//   already saved stay on disk.
import path from "node:path";
import { z } from "zod";
import { BudgetExceededError, assertBudget } from "@/lib/cost";
import { recordingPath } from "@/lib/capture/files";
import type { Slice } from "@/lib/capture/slice";
import { evidenceFor } from "@/lib/inference/evidence";
import { verdict } from "@/lib/inference/verdict";
import { perceiveScene, type PerceiveOptions, type PerceiveResult } from "@/lib/perception/perceive";
import { loadManifest, NotFoundError, readJson, saveResult, scenePath, writeJson } from "@/lib/store/scene";
import { audit } from "@/lib/truth/auditor";
import { AuditUnavailableError } from "@/lib/truth/errors";
import { probe } from "@/lib/video/ffmpeg";
import type {
  AgentName,
  Audit,
  CameraId,
  Claim,
  ClaimResult,
  Evidence,
  GridRow,
  Question,
  RunStatus,
  SceneManifest,
  Verdict,
} from "@/lib/types";
import { eligibleAgent, withoutExcluded } from "@/lib/agent/eligibility";
import { startAgent, type AgentOutcome } from "@/lib/agent/start";

export const RUN_FILE = "run.json";
export const NO_CLAIMS = "no claims; submit the account first";

export interface PipelineDeps {
  loadManifest: (sceneId: string) => Promise<SceneManifest>;
  /** The scene folder, or a file inside it (the store's scenePath). */
  scenePath: (sceneId: string, file?: string) => string;
  loadClaims: (sceneId: string) => Promise<Claim[]>;
  recordingPath: (sceneId: string, camera: CameraId, files?: SceneManifest["files"]) => string | null;
  probe: (file: string) => Promise<{ durationS: number }>;
  /** Dev 1's perceiveScene(): sync -> slice -> scout -> lattice, reading manifest.json itself. */
  perceiveScene: (sceneId: string, opts: PerceiveOptions) => Promise<PerceiveResult>;
  /** questions.json, written by scout during perceive. */
  loadQuestions: (sceneId: string) => Promise<Question[]>;
  /** slices.json, written by sliceScene during perceive. */
  loadSlices: (sceneId: string) => Promise<Slice[]>;
  /** perceiveScene's own options that we pass through (it supports maxSlicesPerCamera). */
  perceiveOptions?: Pick<PerceiveOptions, "maxSlicesPerCamera">;
  evidenceFor: (claim: Claim, rows: GridRow[], questions: Question[]) => Evidence[];
  /** Dev 2's choice of the clip to audit; null means no audit (verdict gets null). */
  pickCitation: (claim: Claim, evidence: Evidence[]) => Evidence | null;
  audit: (claim: Claim, cited: Evidence) => Promise<Audit>;
  verdict: (evidence: Evidence[], claim: Claim, audit: Audit | null) => Verdict;
  saveResult: (sceneId: string, result: ClaimResult) => Promise<void>;
  writeJson: (sceneId: string, file: string, data: unknown) => Promise<void>;
  assertBudget: () => Promise<void>;
  eligibleAgent: (result: ClaimResult, claim: Claim) => AgentName | null;
  /** Runs one agent on one claim (respects AGENT_MODE). */
  startAgent: (agent: AgentName, claim: Claim, sceneId: string) => Promise<AgentOutcome>;
  /** Called whenever the current stage changes (logging; tests use it). */
  onStage?: (stage: string) => void;
  now: () => Date;
}

const ClaimSchema = z.object({
  id: z.string().min(1),
  sceneId: z.string(),
  text: z.string(),
  actor: z.string(),
  object: z.string(),
  action: z.string(),
  window: z.tuple([z.number(), z.number()]),
  timeIsPrecise: z.boolean(),
}) satisfies z.ZodType<Claim>;

/** claims.json from the scene store (Dev 2's account route writes it); [] if it doesn't exist yet. */
export async function loadClaims(sceneId: string): Promise<Claim[]> {
  try {
    return await readJson(sceneId, "claims.json", z.array(ClaimSchema));
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}

/** questions.json from the store (scout writes it). */
export async function loadQuestions(sceneId: string): Promise<Question[]> {
  return readJson<Question[]>(sceneId, "questions.json");
}

/** slices.json from the store (sliceScene writes it). */
export async function loadSlices(sceneId: string): Promise<Slice[]> {
  return readJson<Slice[]>(sceneId, "slices.json");
}

/** The real stages. pickCitation is not on main yet, so callers must supply it. */
export const defaultPipelineDeps: Omit<PipelineDeps, "pickCitation"> = {
  loadManifest,
  scenePath,
  loadClaims,
  recordingPath,
  probe,
  perceiveScene,
  loadQuestions,
  loadSlices,
  evidenceFor,
  audit,
  verdict,
  saveResult,
  writeJson,
  assertBudget: () => assertBudget(),
  eligibleAgent,
  startAgent: (agent, claim, sceneId) => startAgent(agent, claim, sceneId),
  now: () => new Date(),
};

// ---------- one run per scene (in this process) ----------

const locked = new Set<string>();

export const isSceneLocked = (sceneId: string): boolean => locked.has(sceneId);

/** Takes the scene's lock; returns a release function, or null if a run (pipeline or agent) holds it. */
export function lockScene(sceneId: string): (() => void) | null {
  if (locked.has(sceneId)) return null;
  locked.add(sceneId);
  let released = false;
  return () => {
    if (!released) locked.delete(sceneId);
    released = true;
  };
}

// ---------- helpers ----------

class StageError extends Error {}

/** stills.json: camera -> the middle slice's still, as a path inside the scene folder. */
function stillIds(slices: Slice[], excluded: Set<CameraId>): Partial<Record<CameraId, string>> {
  const out: Partial<Record<CameraId, string>> = {};
  const cams = [...new Set(slices.map((s) => s.camera))].filter((c) => !excluded.has(c)).sort();
  for (const c of cams) {
    const list = slices.filter((s) => s.camera === c).sort((a, b) => a.t - b.t);
    const mid = list[Math.floor(list.length / 2)]!;
    out[c] = mid.stillPath.match(/(?:^|[\\/])(stills[\\/].+)$/)?.[1]?.replace(/\\/g, "/") ?? mid.stillPath;
  }
  return out;
}

// ---------- the run ----------

/** Runs the whole pipeline for one scene. Never throws: the final RunStatus (also in run.json) is returned. */
export async function runPipeline(sceneId: string, deps: PipelineDeps): Promise<RunStatus> {
  const d = deps;
  const startedAt = d.now().toISOString();
  let stage = "queued";
  const write = (s: RunStatus) => d.writeJson(sceneId, RUN_FILE, s);
  /** Moves to a stage; `show` writes it to run.json (sub-steps of the claim loop are not written). */
  const enter = async (next: string, show = true) => {
    stage = next;
    d.onStage?.(next);
    if (show) await write({ status: "running", stage, startedAt });
  };

  try {
    // claims: cheapest check first, so nothing is spent on a scene with no account yet.
    await enter("claims");
    const claims = await d.loadClaims(sceneId);
    if (claims.length === 0) throw new StageError(NO_CLAIMS);

    // probe: files and durationS into manifest.json before sync.
    await enter("probe");
    const stored = await d.loadManifest(sceneId);
    const excluded = new Set<CameraId>(stored.excludedCameras);
    const included = stored.cameras.filter((c) => !excluded.has(c));
    const sceneDir = d.scenePath(sceneId);
    // On disk, files are relative to the scene folder. Dev 1's recordingPath() resolves a listed file against
    // the working directory, so every stage gets them resolved through scenePath (absolute) instead.
    const absolute = (files: SceneManifest["files"]): SceneManifest["files"] =>
      Object.fromEntries(Object.entries(files).map(([c, f]) => [c, path.isAbsolute(f!) ? f : d.scenePath(sceneId, f!)]));
    const relFiles: SceneManifest["files"] = {};
    const durations: number[] = [];
    for (const camera of included) {
      const file = d.recordingPath(sceneId, camera, absolute(stored.files));
      if (!file) throw new StageError(`no recording for camera ${camera}`);
      const rel = path.relative(sceneDir, file);
      if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new StageError(`recording for camera ${camera} is outside the scene folder: ${file}`);
      }
      const { durationS } = await d.probe(file);
      relFiles[camera] = rel.split(path.sep).join("/");
      durations.push(durationS);
    }
    const updated: SceneManifest = { ...stored, files: { ...stored.files, ...relFiles }, durationS: Math.min(...durations) };
    // Atomic (temp file + rename). perceiveScene() reads this file itself; Dev 1's recordingPath() resolves
    // the relative paths inside the scene folder.
    await d.writeJson(sceneId, "manifest.json", updated);

    // perceive: Dev 1's sync -> slice -> scout -> lattice in one call.
    await enter("perceive");
    await d.assertBudget();
    const grid: GridRow[] = [];
    let lastStep: string | undefined;
    try {
      await d.perceiveScene(sceneId, {
        ...d.perceiveOptions,
        onStep: (step) => {
          lastStep = step;
        },
        onRows: (rows) => {
          grid.push(...rows);
        },
      });
    } catch (e) {
      // Name the Dev 1 step that failed: the one after the last reported (perceiveScene reports each when done).
      const order = ["sync", "slice", "scout", "lattice"];
      const failing = order[lastStep ? order.indexOf(lastStep) + 1 : 0] ?? "lattice";
      const msg = e instanceof Error ? e.message : String(e);
      throw new StageError(`perceive (${failing}${lastStep ? `, after ${lastStep}` : ""}): ${msg}`);
    }
    const questions = await d.loadQuestions(sceneId);
    const slices = (await d.loadSlices(sceneId)).filter((s) => !excluded.has(s.camera));
    const rows = grid.filter((r) => !excluded.has(r.camera));

    await enter("evidence");
    const saved: { claim: Claim; result: ClaimResult }[] = [];
    for (const claim of claims) {
      await enter("evidence", false);
      const evidence = withoutExcluded(d.evidenceFor(claim, rows, questions), updated.excludedCameras);
      const cited = d.pickCitation(claim, evidence);
      let checked: Audit | null = null;
      if (cited) {
        await enter("audit", false);
        await d.assertBudget();
        try {
          checked = await d.audit(claim, cited);
        } catch (e) {
          // Dev 2's documented contract: no reachable media -> verdict without an audit (Insufficient path).
          if (!(e instanceof AuditUnavailableError)) throw e;
        }
      }
      await enter("verdict", false);
      const result: ClaimResult = { claimId: claim.id, verdict: d.verdict(evidence, claim, checked), evidence, audit: checked, history: [] };
      await d.saveResult(sceneId, result);
      saved.push({ claim, result });
    }

    await enter("stills");
    await d.writeJson(sceneId, "stills.json", stillIds(slices, excluded));

    await enter("agents");
    const work = saved
      .map(({ claim, result }) => ({ claim, agent: d.eligibleAgent(result, claim) }))
      .filter((w): w is { claim: Claim; agent: AgentName } => w.agent !== null);
    if (work.length) await d.assertBudget();
    for (const { claim, agent } of work) await d.startAgent(agent, claim, sceneId); // saves its own result

    const done: RunStatus = { status: "done", stage: "done", startedAt, finishedAt: d.now().toISOString() };
    await write(done);
    return done;
  } catch (e) {
    const error = e instanceof BudgetExceededError ? "budget" : e instanceof Error ? e.message : String(e);
    const failed: RunStatus = { status: "failed", stage, startedAt, finishedAt: d.now().toISOString(), error };
    if (!(e instanceof StageError) && !(e instanceof BudgetExceededError)) console.error(`[pipeline] ${sceneId} ${stage}:`, e);
    try {
      await write(failed);
    } catch (w) {
      console.error(`[pipeline] ${sceneId}: could not write ${RUN_FILE}:`, w);
    }
    return failed;
  }
}

export type StartResult = { started: true; done: Promise<RunStatus> } | { started: false; reason: string };

/**
 * Starts the pipeline in the background if the scene is not already running (pipeline or agent).
 * Writes run.json { status: "queued" } first. The lock is released when the run ends.
 */
export function startPipeline(sceneId: string, deps: PipelineDeps): StartResult {
  const release = lockScene(sceneId);
  if (!release) return { started: false, reason: `Scene ${sceneId} already has a run in progress.` };
  const done = (async () => {
    try {
      await deps.writeJson(sceneId, RUN_FILE, { status: "queued", stage: "queued", startedAt: deps.now().toISOString() } satisfies RunStatus);
      return await runPipeline(sceneId, deps);
    } finally {
      release();
    }
  })();
  return { started: true, done };
}
