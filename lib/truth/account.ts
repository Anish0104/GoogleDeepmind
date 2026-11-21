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
//     (never precise) instead of being withheld. A model failure is 502; no surviving claim is 422 (with the rejection reasons), writing nothing: never an empty account.
//  5. Per claim, in order:
//     - a stored result already changed by an agent (history entry not by "initial") is kept as is;
//     - resolveGrounding() with Dev 1's registered exclusive state pairs (lib/truth/exclusive.ts), so a
//       state like touching_worker may be contradicted by its registered opposite clear_of_worker;
//       no reliable target (incl. negated or temporally ordered claims) -> Insufficient, no audit call;
//     - evidenceForTarget() on rows from allowed cameras only (manifest cameras minus excluded);
//     - choose the audit goal from that evidence: support if a usable camera supports at CLEAR, else
//       contradiction if one contradicts at DECISIVE; both or neither -> no audit (verdict() cannot
//       label it anyway);
//     - selectCitation() (window inside the claim, allowed cameras only); assertBudget(); auditCitation().
//       Budget exhaustion or any audit failure -> audit null;
//     - the label comes only from verdict(evidence, claim, audit).
//  6. Persist: claims.json replaced with this account's claims; each result written with the store's
//     compare-and-save saveResultIf(result, entrySeenAtStart): one entry per claimId, and if anything
//     wrote that claim since this run read it (e.g. an agent), that entry is kept and returned instead.
//     Results of claims from an earlier account stay in results.json (the board only shows claims.json's);
//     removeResult() is not conditional, so they are not deleted here.
//  Runs for one scene go through the store's shared serialised() scene queue, which the agent routes'
//  lockScene() also uses; inside it only per-file locks are taken, so there is no nested scene lock.
//
// Audit.clipId stays the citation's grid reference ("grid:<scene>:<camera>:<start>-<end>"), not a
// playable clip; Evidence.clipId values are grid references too.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Audit, CameraId, Claim, ClaimResult, GridRow, SceneManifest } from "@/lib/types";
import { THRESHOLDS } from "@/lib/config";
import { assertBudget, BudgetExceededError } from "@/lib/cost";
import { NotFoundError, loadManifest, loadResults, readJson, saveResultIf, scenePath, serialised, writeJson } from "@/lib/store/scene";
import { selectCitation, type CitationGoal } from "@/lib/inference/citation";
import { evidenceForTarget } from "@/lib/inference/evidence";
import { CAMERA_IDS } from "@/lib/inference/grid";
import { verdict } from "@/lib/inference/verdict";
import { auditCitation } from "@/lib/truth/auditor";
import { splitClaimsDetailed } from "@/lib/truth/claims";
import { ClaimExtractionError, ClaimOutputError } from "@/lib/truth/errors";
import { checkStatement } from "@/lib/truth/statement";
import { resolveGrounding, type SceneRegistry } from "@/lib/truth/grounding";
import { registeredExclusivePairs } from "@/lib/truth/exclusive";

/** A failure of the account request, with the HTTP status the route returns. */
/**
 * Why an account produced no labels, so the UI can say what to do: not_a_statement (rejected before any model
 * call), no_claims_proposed (the model found none), claims_rejected (every proposed claim failed validation),
 * model_output_invalid (unusable model output, after one retry), model_unavailable (the model call failed).
 */
export type AccountErrorCode = "not_a_statement" | "no_claims_proposed" | "claims_rejected" | "model_output_invalid" | "model_unavailable";

export class AccountError extends Error {
  constructor(
    readonly status: 400 | 404 | 422 | 429 | 500 | 502 | 503,
    message: string,
    options?: { cause?: unknown; code?: AccountErrorCode },
  ) {
    super(message, options);
    this.code = options?.code;
    this.name = "AccountError";
  }
  readonly code: AccountErrorCode | undefined;
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

/** Runs the initial account for a scene and returns one ClaimResult per extracted claim, in order. */
export async function runAccount(sceneId: string, transcript: unknown): Promise<ClaimResult[]> {
  if (typeof sceneId !== "string" || !SCENE_ID.test(sceneId)) throw new AccountError(400, "Invalid scene id.");
  if (typeof transcript !== "string" || transcript.trim() === "") throw new AccountError(400, "Body must be {\"transcript\": \"...\"} with a non-empty transcript.");
  const statement = checkStatement(transcript);
  if (!statement.ok) throw new AccountError(422, statement.reason, { code: "not_a_statement" }); // no model call
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
    const registry: SceneRegistry = { entities, people, questions, exclusive: registeredExclusivePairs() };
    const durationS = manifest.durationS > 0 ? manifest.durationS : undefined;

    await budgetBeforeExtraction();
    let claims: Claim[];
    try {
      // The scene length lets untimed claims span the scene (never precise) instead of being withheld.
      const parsed = await splitClaimsDetailed(transcript, sceneId, durationS === undefined ? {} : { durationS });
      claims = parsed.claims;
      const reasons = parsed.rejected.map((r) => `#${r.index + 1}: ${r.reason}`);
      if (reasons.length > 0) console.warn(`[account] scene ${sceneId}: rejected ${reasons.length} extracted claim(s): ${reasons.join("; ")}`);
      // No verifiable claim: an error, not an empty account. Nothing is written, so the stored claims and
      // results (and any agent work on them) stay as they were.
      if (claims.length === 0)
        throw new AccountError(
          422,
          reasons.length > 0
            ? `The model proposed ${reasons.length} claim(s), but none passed validation (rejected: ${reasons.join("; ")}). Rephrase using the people and objects as you would name them.`
            : "No verifiable claims were extracted from the statement (the model proposed none). Describe concrete events: who or what moved, stopped, touched or dodged.",
          { code: reasons.length > 0 ? "claims_rejected" : "no_claims_proposed" },
        );
    } catch (e) {
      if (e instanceof ClaimOutputError) throw new AccountError(502, `The model's response could not be read (tried twice): ${e.message}. Try again.`, { cause: e, code: "model_output_invalid" });
      if (e instanceof ClaimExtractionError) throw new AccountError(502, `Claim extraction failed: ${e.message}`, { cause: e, code: "model_unavailable" });
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
    // Compare-and-save (store's saveResultIf): written only if the stored entry still equals what this
    // run read at the start, checked and written under one file lock. If anything else wrote the claim
    // meanwhile (e.g. an agent), its entry is kept and returned instead.
    const out: ClaimResult[] = [];
    for (const r of results) {
      const seen = before.get(r.claimId) ?? null;
      if (r === seen) {
        out.push(r); // preserved agent-updated result: nothing to write
        continue;
      }
      const { saved, current } = await saveResultIf(sceneId, r, seen);
      out.push(saved ? r : (current ?? r));
    }
    return out;
  });
}
