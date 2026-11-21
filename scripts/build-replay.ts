// OWNER: Dev 3. Regenerates the sample replay in fixtures/replay/demo-scene/. No models, no network.
// Usage: pnpm tsx scripts/build-replay.ts
//
// Pipeline (real code wherever it exists):
//   Dev 2's fakeGrid() -> grid.jsonl; stateModel() -> events.json; evidenceFor() + verdict() -> initial labels.
//   investigate() / challenge() with a scripted fake model -> agent-steps.jsonl and the updated results.json.
// Stand-ins (marked): the auditor (Decision 1 on the cited clip) and Dev 1's checkWindow(). The fake
// checkWindow() scores a clip from a second "clip-level" grid with less occlusion: a 3 s clip with an
// entity crop can see past a person who blocks the half-second stills.
//
// The four claims: c1 strong Supported (no agent), c2 Insufficient settled by the Investigator,
// c3 Contradicted that survives the Skeptic, c4 seen only by excluded camera D, stays Insufficient.
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CheckWindowArgs } from "@/lib/perception/checkWindow";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import type { ModelReply, StandinModel } from "@/lib/agent/standin";
import type { Audit, CameraId, Claim, ClaimResult, Event, Evidence, GridRow, Question, Verdict } from "@/lib/types";

export const SCENE_ID = "demo-scene";
export const REPLAY_FILES = [
  "manifest.json",
  "grid.jsonl",
  "events.json",
  "claims.json",
  "results.json",
  "agent-steps.jsonl",
  "views.json",
  "stills.json",
] as const;

export const EXPECTED: Record<string, { initial: Verdict; final: Verdict; agent: "investigator" | "skeptic" | null }> = {
  c1: { initial: "Supported", final: "Supported", agent: null },
  c2: { initial: "Insufficient", final: "Supported", agent: "investigator" },
  c3: { initial: "Contradicted", final: "Contradicted", agent: "skeptic" },
  c4: { initial: "Insufficient", final: "Insufficient", agent: "investigator" },
};

const CAMERAS: CameraId[] = ["A", "B", "C", "D"];
const EXCLUDED: CameraId[] = ["D"]; // e.g. the phone slipped; its footage exists but never counts
const DURATION_S = 30;
const SEED = 7;
const CREATED_AT = new Date("2026-11-21T15:00:00.000Z");

const loc = (id: string, entityId: string, what: string, zone: string): Question => ({
  id,
  entityId,
  predicate: "location",
  value: zone,
  text: `Is the ${what} in zone ${zone}?`,
});
const QUESTIONS: Question[] = [
  loc("mug-B", "mug", "red mug", "B"),
  loc("mug-C", "mug", "red mug", "C"),
  loc("mug-D", "mug", "red mug", "D"),
  loc("kettle-C", "kettle", "kettle", "C"),
  loc("kettle-E", "kettle", "kettle", "E"),
];

const truthEvent = (entityId: string, from: string, to: string, t: number): Event => ({
  entityId,
  from,
  to,
  t,
  confidence: 1,
  cameras: [],
});
// What really happened: the mug goes B -> C at 6 s and C -> D at 16 s; the kettle goes C -> E at 24 s.
const TRUTH: Event[] = [
  truthEvent("mug", "unknown", "B", 0),
  truthEvent("mug", "B", "C", 6),
  truthEvent("mug", "C", "D", 16),
  truthEvent("kettle", "unknown", "C", 0),
  truthEvent("kettle", "C", "E", 24),
];

// A person blocks cameras A-C in the stills around 14-19 s and 22-28 s. In a clip with an entity crop,
// camera C sees past them at 14-19 s; nothing but excluded camera D ever sees 22-28 s.
const block = (cams: CameraId[], window: [number, number]) => cams.map((camera) => ({ camera, window }));
const STILL_OCCLUSION = [...block(["A", "B", "C"], [14, 19]), ...block(["A", "B", "C"], [22, 28])];
const CLIP_OCCLUSION = [...block(["A", "B"], [14, 19]), ...block(["A", "B", "C"], [22, 28])];

const claim = (id: string, text: string, actor: string, object: string, action: string, window: [number, number]): Claim => ({
  id,
  sceneId: SCENE_ID,
  text,
  actor,
  object,
  action,
  window,
  timeIsPrecise: true,
});
export const CLAIMS: Claim[] = [
  claim("c1", "Sam put the red mug in zone C", "Sam", "red mug", "put", [5, 9]),
  claim("c2", "Then Sam moved the red mug to zone D", "Sam", "red mug", "moved", [15, 18]),
  claim("c3", "Ana put the kettle in zone E", "Ana", "kettle", "put", [8, 11]),
  claim("c4", "Later Ana moved the kettle to zone E", "Ana", "kettle", "moved", [23, 26]),
];

const VIEWS = [
  { camera: "A", text: "front of the mat, zones A-C; a person often stands in front of it" },
  { camera: "B", text: "left side, zones B-D, low angle" },
  { camera: "C", text: "high right corner, wide view of zones C-F" },
  { camera: "D", text: "fell over during the scene (excluded)" },
];
const STILLS = { A: "demo-still-A", B: "demo-still-B", C: "demo-still-C", D: "demo-still-D" };

type Script = { name: string; args: unknown }[];
const inspect = (camera_id: CameraId, start_s: number, end_s: number, crop: "full" | "entity", reason: string) => ({
  name: "inspect_window",
  args: { camera_id, start_s, end_s, crop, reason },
});
const stop = (reason: string) => ({ name: "stop", args: { reason } });
// The fake model's tool calls, per claim (what a sensible agent would pick from the menu).
const SCRIPTS: Record<string, Script> = {
  c2: [
    inspect("C", 15, 18, "entity", "Camera C sees zone D from above; an entity crop may see past the person."),
    stop("Camera C settles where the mug went."),
  ],
  c3: [
    inspect("B", 8, 11, "entity", "Camera B could show the kettle partly hidden in zone E."),
    stop("Camera B also shows the kettle still in zone C; no other clip could undermine the label."),
  ],
  c4: [
    inspect("A", 23, 26, "entity", "Camera A faces zones A-C; an entity crop might catch the kettle."),
    inspect("D", 23, 26, "full", "Camera D had the clearest view of zone E."), // rejected: D is excluded
  ],
};

/** Stand-in auditor: Decision 1 on the cited clip = the strongest usable view, or no audit if none. */
function citedAudit(evidence: Evidence[], usable: number): Audit | null {
  const strength = (e: Evidence) => Math.max(e.supports ?? 0, e.contradicts ?? 0);
  const best = evidence.filter((e) => e.visible >= usable).sort((a, b) => strength(b) - strength(a))[0];
  return best ? { supportScore: best.supports, contradictScore: best.contradicts, clipId: best.clipId } : null;
}

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** Decimal places kept for grid probabilities, so the replay is identical on every platform. */
export const GRID_DECIMALS = 6;
const round = (x: number) => Math.round(x * 10 ** GRID_DECIMALS) / 10 ** GRID_DECIMALS;

/**
 * Builds the replay into outDir. Sets DATA_DIR to a temp work folder and imports everything that reads
 * lib/config.ts afterwards (config reads DATA_DIR once at import). Restores DATA_DIR when done.
 */
export async function buildReplay(outDir: string): Promise<Record<string, { initial: Verdict; final: Verdict }>> {
  const work = await mkdtemp(path.join(tmpdir(), "rashomon-replay-"));
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = work;
  try {
    const { THRESHOLDS } = await import("@/lib/config");
    const { fakeGrid } = await import("@/lib/inference/fake-grid");
    const { evidenceFor } = await import("@/lib/inference/evidence");
    const { stateModel } = await import("@/lib/inference/state");
    const { verdict } = await import("@/lib/inference/verdict");
    const store = await import("@/lib/store/scene");
    const { eligibleAgent, withoutExcluded } = await import("@/lib/agent/eligibility");
    const { investigate } = await import("@/lib/agent/investigator");
    const { challenge } = await import("@/lib/agent/skeptic");
    const { standinTurn } = await import("@/lib/agent/standin");
    const { SYSTEM_PROMPTS } = await import("@/lib/agent/prompts");

    const grid = (occluded: typeof STILL_OCCLUSION) =>
      fakeGrid({
        sceneId: SCENE_ID,
        cameras: CAMERAS,
        durationS: DURATION_S,
        truth: TRUTH,
        questions: QUESTIONS,
        noise: 0.2,
        sharedErrorRate: 0,
        occluded,
        seed: SEED,
      });
    // Math.exp/log can differ in the last digits between macOS and Linux. Round every probability once,
    // here, before anything uses it: the stored grid, evidence, verdicts and agent clip checks all agree.
    const rounded = (rs: GridRow[]) => rs.map((r) => ({ ...r, pYes: round(r.pYes), pVisible: round(r.pVisible) }));
    const rows = rounded(grid(STILL_OCCLUSION));
    const clipRows = rounded(grid(CLIP_OCCLUSION));

    // ---- scene, grid, events, views, stills, claims ----
    await store.createScene(
      { split: "demo", room: "studio", cameras: CAMERAS, excludedCameras: EXCLUDED, plannedOcclusion: true },
      { id: SCENE_ID, now: CREATED_AT },
    );
    const manifest = { ...(await store.loadManifest(SCENE_ID)), durationS: DURATION_S };
    await store.writeJson(SCENE_ID, "manifest.json", manifest);
    await writeFile(store.scenePath(SCENE_ID, "grid.jsonl"), jsonl(rows), "utf8");
    // Events from included cameras only.
    await store.writeJson(SCENE_ID, "events.json", stateModel(rows.filter((r) => !EXCLUDED.includes(r.camera)), QUESTIONS));
    await store.writeJson(SCENE_ID, "views.json", VIEWS);
    await store.writeJson(SCENE_ID, "stills.json", STILLS);
    await store.writeJson(SCENE_ID, "claims.json", CLAIMS);

    // ---- initial labels: evidence (included cameras only), stand-in audit, verdict() ----
    const summary: Record<string, { initial: Verdict; final: Verdict }> = {};
    for (const c of CLAIMS) {
      const evidence = withoutExcluded(evidenceFor(c, rows, QUESTIONS), EXCLUDED);
      const audit = citedAudit(evidence, THRESHOLDS.USABLE);
      const initial: ClaimResult = { claimId: c.id, verdict: verdict(evidence, c, audit), evidence, audit, history: [] };
      await store.saveResult(SCENE_ID, initial);
      summary[c.id] = { initial: initial.verdict, final: initial.verdict };
    }

    // ---- agents: scripted fake model, fake clip check, fixed clocks so the output is reproducible ----
    const checkWindow = async (a: CheckWindowArgs): Promise<Evidence> => {
      const runs = evidenceFor({ ...a.claim, window: a.window }, clipRows, QUESTIONS).filter((e) => e.camera === a.camera);
      const usable = runs.filter((e) => e.visible >= THRESHOLDS.USABLE);
      const pick = usable[0] ?? runs[0];
      const clipId = `clip:${SCENE_ID}:${a.camera}:${a.window[0]}-${a.window[1]}:${a.crop}`;
      if (!pick) return { camera: a.camera, window: a.window, visible: 0, supports: null, contradicts: null, clipId, source: a.source };
      return { ...pick, window: a.window, clipId, source: a.source };
    };
    let tick = 0;
    const now = () => new Date(Date.parse("2026-11-21T15:05:00.000Z") + 1000 * tick++);

    for (const c of CLAIMS) {
      const result = (await store.loadResults(SCENE_ID)).find((r) => r.claimId === c.id)!;
      const agent = eligibleAgent({ ...result, evidence: withoutExcluded(result.evidence, EXCLUDED) }, c);
      if (agent === null) continue;

      const script = SCRIPTS[c.id] ?? [];
      let i = 0;
      const model: StandinModel = {
        generate: async (): Promise<ModelReply> => ({
          call: script[i++] ?? stop("Nothing else in the menu could change the result."),
          text: null,
          inputTokens: 1_850,
          outputTokens: 45,
          costUsd: 0,
        }),
      };
      let clockMs = 0;
      const clock = () => (clockMs += 900); // every turn reports 900 ms
      const turn = ({ agent: a, menu, history }: TurnInput): Promise<TurnOutput> =>
        standinTurn(SYSTEM_PROMPTS[a], menu, history, model, clock);
      const deps = { turn, checkWindow, audit: async (_c: Claim, e: Evidence) => citedAudit([e], 0)!, assertBudget: async () => {}, now };

      const out = agent === "investigator" ? await investigate(c, SCENE_ID, deps) : await challenge(c, SCENE_ID, deps);
      if (!out.ran) throw new Error(`Replay: ${agent} refused ${c.id}: ${out.reason}`);
      summary[c.id]!.final = out.run.result.verdict;
    }

    // ---- check the story, then copy the scene folder out ----
    for (const [id, want] of Object.entries(EXPECTED)) {
      const got = summary[id];
      if (got?.initial !== want.initial || got.final !== want.final) {
        throw new Error(`Replay ${id}: expected ${want.initial} -> ${want.final}, got ${got?.initial} -> ${got?.final}.`);
      }
    }
    await mkdir(outDir, { recursive: true });
    for (const f of REPLAY_FILES) await copyFile(store.scenePath(SCENE_ID, f), path.join(outDir, f));
    return summary;
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const out = path.join(process.cwd(), "fixtures/replay/demo-scene");
  const summary = await buildReplay(out);
  for (const [id, s] of Object.entries(summary)) console.log(`${id}: ${s.initial} -> ${s.final}`);
  console.log(`Wrote ${REPLAY_FILES.length} files to ${path.relative(process.cwd(), out)}/`);
}
