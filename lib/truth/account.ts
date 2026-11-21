// OWNER: Dev 2. The initial-account pipeline behind POST /api/scene/[id]/account:
// transcript -> claims -> grounding -> per-camera evidence -> one audited citation -> verdict().
//
// Order and failure policy (every failure is explicit; nothing is guessed):
//  1. Validate the scene id and transcript (400). Load the manifest (404 missing, 422 malformed).
//  2. Load entities.json, people.json, questions.json and grid.jsonl BEFORE any model call. A file that
//     is missing means perception has not produced it yet: grounding/evidence for it is simply absent,
//     so affected claims end Insufficient. A file that is present but malformed is a 422.
//     Unparseable grid.jsonl lines are skipped (a live append can leave a half-written last line).
//  3. assertBudget() before claim extraction: over budget is 429, an unreadable budget is 503 (fail closed).
//  4. splitClaims(), with the manifest's durationS when it is > 0 so untimed claims span the scene
//     (never precise) instead of being withheld. A model failure is 502: never an empty account.
//  5. Per claim, in order:
//     - a stored result already changed by an agent (history entry not by "initial") is kept as is;
//     - resolveGrounding(); no reliable target -> Insufficient, no audit call;
//     - evidenceForTarget() on rows from allowed cameras only (manifest cameras minus excluded);
//     - choose the audit goal from that evidence: support if a usable camera supports at CLEAR, else
//       contradiction if one contradicts at DECISIVE; both or neither -> no audit (verdict() cannot
//       label it anyway);
//     - selectCitation() (window inside the claim, allowed cameras only); assertBudget(); auditCitation().
//       Budget exhaustion or any audit failure -> audit null;
//     - the label comes only from verdict(evidence, claim, audit).
//  6. Persist: claims.json replaced with this account's claims; each result upserted with saveResult()
//     (one entry per claimId, no duplicates). Right before saving, the stored entry is re-read: if it
//     changed during this run (e.g. an agent saved), it is not overwritten. Results of claims from an
//     earlier account stay in results.json; the board only shows results for claims.json. Deleting
//     them safely would need a store API (Dev 3).
//  Runs for one scene are serialised in this process.
//
// Audit.clipId stays the citation's grid reference ("grid:<scene>:<camera>:<start>-<end>"), not a
// playable clip; Evidence.clipId values are grid references too.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Audit, CameraId, Claim, ClaimResult, GridRow, SceneManifest } from "@/lib/types";
import { THRESHOLDS } from "@/lib/config";
import { assertBudget, BudgetExceededError } from "@/lib/cost";
import { NotFoundError, loadManifest, loadResults, readJson, saveResult, scenePath, writeJson } from "@/lib/store/scene";
import { selectCitation, type CitationGoal } from "@/lib/inference/citation";
import { evidenceForTarget } from "@/lib/inference/evidence";
import { CAMERA_IDS } from "@/lib/inference/grid";
import { verdict } from "@/lib/inference/verdict";
import { auditCitation } from "@/lib/truth/auditor";
import { splitClaims } from "@/lib/truth/claims";
import { ClaimExtractionError } from "@/lib/truth/errors";
import { resolveGrounding, type SceneRegistry } from "@/lib/truth/grounding";

/** A failure of the account request, with the HTTP status the route returns. */
export class AccountError extends Error {
  constructor(
    readonly status: 400 | 404 | 422 | 429 | 500 | 502 | 503,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AccountError";
  }
}

const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // same rule as lib/store/scene.ts

const RowSchema = z.object({
  sceneId: z.string(),
  camera: z.enum(["A", "B", "C", "D"]),
  t: z.number(),
  questionId: z.string(),
  pYes: z.number(),
  pVisible: z.number(),
});

// ---------- scene inputs ----------

/** A registry file: undefined when missing; 422 when present but not valid JSON or not a list. */
async function readRegistry(sceneId: string, file: string): Promise<unknown[] | undefined> {
  let data: unknown;
  try {
    data = await readJson<unknown>(sceneId, file);
  } catch (e) {
    if (e instanceof NotFoundError) return undefined;
    throw new AccountError(422, `Scene ${sceneId} ${file} is malformed: ${(e as Error).message}`, { cause: e });
  }
  if (!Array.isArray(data)) throw new AccountError(422, `Scene ${sceneId} ${file} is malformed: expected a JSON array.`);
  return data;
}

/** grid.jsonl rows ([] when missing). Unparseable or invalid lines are skipped and counted. */
async function readGrid(sceneId: string): Promise<GridRow[]> {
  let text: string;
  try {
    text = await readFile(scenePath(sceneId, "grid.jsonl"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new AccountError(500, `Could not read scene ${sceneId} grid.jsonl.`, { cause: e });
  }
  const rows: GridRow[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = RowSchema.safeParse(JSON.parse(line));
      if (r.success) rows.push(r.data);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) console.warn(`[account] scene ${sceneId}: skipped ${skipped} unparseable grid.jsonl line(s).`);
  return rows;
}

async function loadSceneManifest(sceneId: string): Promise<SceneManifest> {
  try {
    return await loadManifest(sceneId);
  } catch (e) {
    if (e instanceof NotFoundError) throw new AccountError(404, `Scene ${sceneId} not found.`, { cause: e });
    throw new AccountError(422, `Scene ${sceneId} manifest is malformed: ${(e as Error).message}`, { cause: e });
  }
}

async function budgetBeforeExtraction(): Promise<void> {
  try {
    await assertBudget();
  } catch (e) {
    if (e instanceof BudgetExceededError) throw new AccountError(429, e.message, { cause: e });
    throw new AccountError(503, "Could not check the budget; refusing to call the model.", { cause: e });
  }
}

// ---------- per claim ----------

const agentTouched = (r: ClaimResult | undefined) => !!r && r.history.some((h) => h.by !== "initial");

function auditGoal(evidence: ClaimResult["evidence"]): CitationGoal | null {
  const usable = evidence.filter((e) => e.visible >= THRESHOLDS.USABLE);
  const supports = usable.some((e) => e.supports !== null && e.supports >= THRESHOLDS.CLEAR);
  const contradicts = usable.some((e) => e.contradicts !== null && e.contradicts >= THRESHOLDS.DECISIVE);
  if (supports === contradicts) return null; // neither, or cameras conflict: verdict() is Insufficient either way
  return supports ? "support" : "contradict";
}

async function labelClaim(
  claim: Claim,
  registry: SceneRegistry,
  rows: GridRow[],
  allowed: CameraId[],
  durationS: number | undefined,
): Promise<ClaimResult> {
  const questions = (registry.questions as Parameters<typeof evidenceForTarget>[3] | undefined) ?? [];
  const grounding = resolveGrounding(claim, registry);
  const evidence = evidenceForTarget(claim, grounding.target, rows, questions);
  let audit: Audit | null = null;

  const goal = grounding.target ? auditGoal(evidence) : null;
  if (goal) {
    const sel = selectCitation(claim, grounding.target, rows, questions, { goal, allowedCameras: allowed, durationS });
    if (sel.ok) {
      try {
        await assertBudget();
        audit = await auditCitation(claim, sel.candidate);
      } catch (e) {
        // Budget exhaustion, an unavailable clip, a bad citation or a malformed answer: no audit, no label.
        if (!(e instanceof BudgetExceededError)) console.warn(`[account] audit failed for ${claim.id}: ${(e as Error).message}`);
        audit = null;
      }
    }
  }
  return { claimId: claim.id, verdict: verdict(evidence, claim, audit), evidence, audit, history: [] };
}

// ---------- run ----------

const running = new Map<string, Promise<unknown>>();

/** Serialises account runs per scene within this process. */
async function serialised<T>(sceneId: string, fn: () => Promise<T>): Promise<T> {
  const prev = running.get(sceneId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  running.set(sceneId, tail);
  try {
    return await run;
  } finally {
    if (running.get(sceneId) === tail) running.delete(sceneId);
  }
}

/** Runs the initial account for a scene and returns one ClaimResult per extracted claim, in order. */
export async function runAccount(sceneId: string, transcript: unknown): Promise<ClaimResult[]> {
  if (typeof sceneId !== "string" || !SCENE_ID.test(sceneId)) throw new AccountError(400, "Invalid scene id.");
  if (typeof transcript !== "string" || transcript.trim() === "") throw new AccountError(400, "Body must be {\"transcript\": \"...\"} with a non-empty transcript.");
  return serialised(sceneId, async () => {
    const manifest = await loadSceneManifest(sceneId);
    const [entities, people, questions, rows] = await Promise.all([
      readRegistry(sceneId, "entities.json"),
      readRegistry(sceneId, "people.json"),
      readRegistry(sceneId, "questions.json"),
      readGrid(sceneId),
    ]);
    const allowed = CAMERA_IDS.filter((c) => manifest.cameras.includes(c) && !manifest.excludedCameras.includes(c));
    const allowedRows = rows.filter((r) => allowed.includes(r.camera));
    const registry: SceneRegistry = { entities, people, questions };
    const durationS = manifest.durationS > 0 ? manifest.durationS : undefined;

    await budgetBeforeExtraction();
    let claims: Claim[];
    try {
      // The scene length lets untimed claims span the scene (never precise) instead of being withheld.
      claims = await splitClaims(transcript, sceneId, durationS === undefined ? {} : { durationS });
    } catch (e) {
      if (e instanceof ClaimExtractionError) throw new AccountError(502, `Claim extraction failed: ${e.message}`, { cause: e });
      throw e;
    }

    let before: Map<string, ClaimResult>;
    try {
      before = new Map((await loadResults(sceneId)).map((r) => [r.claimId, r]));
    } catch (e) {
      throw new AccountError(500, `Scene ${sceneId} results.json is unreadable; refusing to overwrite it.`, { cause: e });
    }

    const results: ClaimResult[] = [];
    for (const claim of claims) {
      const existing = before.get(claim.id);
      results.push(agentTouched(existing) ? existing! : await labelClaim(claim, registry, allowedRows, allowed, durationS));
    }

    await writeJson(sceneId, "claims.json", claims);
    const now = new Map((await loadResults(sceneId)).map((r) => [r.claimId, r]));
    return Promise.all(
      results.map(async (r) => {
        const seen = before.get(r.claimId);
        const current = now.get(r.claimId);
        // Do not overwrite an entry that changed while this run was labelling.
        if (JSON.stringify(current) !== JSON.stringify(seen)) return current ?? r;
        if (r !== seen) await saveResult(sceneId, r);
        return r;
      }),
    );
  });
}
