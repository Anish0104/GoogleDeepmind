// OWNER: Dev 3. The sample replay in fixtures/replay/demo-scene/: every file parses with the shared types,
// the four claims tell the intended story, and scripts/build-replay.ts reproduces it byte for byte.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  AgentStep,
  Audit,
  Claim,
  ClaimResult,
  Event,
  Evidence,
  GridRow,
  LabelChange,
  ViewDescription,
} from "@/lib/types";
import { InspectWindowArgsSchema, StopArgsSchema } from "@/lib/agent/bridge";
import { SceneManifestSchema } from "@/lib/store/scene";
import { CLAIMS, EXPECTED, REPLAY_FILES, SCENE_ID } from "@/scripts/build-replay";

const DIR = path.join(process.cwd(), "fixtures/replay", SCENE_ID);

// ---------- schemas tied to lib/types.ts ----------
const Camera = z.enum(["A", "B", "C", "D"]);
const VerdictS = z.enum(["Supported", "Contradicted", "Insufficient"]);
const Window = z.tuple([z.number(), z.number()]);
const Score = z.number().min(0).max(1);

const GridRowS = z.strictObject({
  sceneId: z.string(),
  camera: Camera,
  t: z.number(),
  questionId: z.string(),
  pYes: Score,
  pVisible: Score,
}) satisfies z.ZodType<GridRow>;
const EventS = z.strictObject({
  entityId: z.string(),
  from: z.string(),
  to: z.string(),
  t: z.number(),
  confidence: Score,
  cameras: z.array(Camera),
}) satisfies z.ZodType<Event>;
const ClaimS = z.strictObject({
  id: z.string(),
  sceneId: z.string(),
  text: z.string(),
  actor: z.string(),
  object: z.string(),
  action: z.string(),
  window: Window,
  timeIsPrecise: z.boolean(),
}) satisfies z.ZodType<Claim>;
const EvidenceS = z.strictObject({
  camera: Camera,
  window: Window,
  visible: Score,
  supports: Score.nullable(),
  contradicts: Score.nullable(),
  clipId: z.string(),
  source: z.enum(["initial", "investigator", "skeptic"]),
}) satisfies z.ZodType<Evidence>;
const AuditS = z.strictObject({
  supportScore: Score.nullable(),
  contradictScore: Score.nullable(),
  clipId: z.string(),
}) satisfies z.ZodType<Audit>;
const LabelChangeS = z.strictObject({
  from: VerdictS,
  to: VerdictS,
  by: z.enum(["initial", "investigator", "skeptic"]),
  blocked: z.boolean().optional(),
  reason: z.string(),
  at: z.iso.datetime(),
}) satisfies z.ZodType<LabelChange>;
const ClaimResultS = z.strictObject({
  claimId: z.string(),
  verdict: VerdictS,
  evidence: z.array(EvidenceS),
  audit: AuditS.nullable(),
  history: z.array(LabelChangeS),
}) satisfies z.ZodType<ClaimResult>;
const AgentStepS = z.strictObject({
  agent: z.enum(["investigator", "skeptic"]),
  claimId: z.string(),
  n: z.number().int().positive(),
  action: z.enum(["inspect_window", "stop", "rejected"]),
  args: z.union([InspectWindowArgsSchema.strict(), StopArgsSchema.strict()]),
  rejectionReason: z.string().optional(),
  droppedFields: z.array(z.string()).optional(),
  result: EvidenceS.optional(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
}) satisfies z.ZodType<AgentStep>;
const ViewS = z.strictObject({ camera: Camera, text: z.string() }) satisfies z.ZodType<ViewDescription>;
const StillsS = z.partialRecord(Camera, z.string());

const read = (f: string) => readFile(path.join(DIR, f), "utf8");
const json = async <T>(f: string, s: z.ZodType<T>) => s.parse(JSON.parse(await read(f)));
const jsonl = async <T>(f: string, s: z.ZodType<T>) =>
  (await read(f))
    .trimEnd()
    .split("\n")
    .map((l) => s.parse(JSON.parse(l)));

describe("fixtures/replay/demo-scene", () => {
  it("every file parses with the shared types", async () => {
    const manifest = await json("manifest.json", SceneManifestSchema);
    expect(manifest.sceneId).toBe(SCENE_ID);
    expect((await jsonl("grid.jsonl", GridRowS)).length).toBeGreaterThan(0);
    await json("events.json", z.array(EventS));
    await json("claims.json", z.array(ClaimS));
    await json("results.json", z.array(ClaimResultS));
    await jsonl("agent-steps.jsonl", AgentStepS);
    await json("views.json", z.array(ViewS));
    await json("stills.json", StillsS);
  });

  it("tells the intended story: one claim of each kind", async () => {
    const claims = await json("claims.json", z.array(ClaimS));
    const results = await json("results.json", z.array(ClaimResultS));
    const steps = await jsonl("agent-steps.jsonl", AgentStepS);

    expect(claims).toEqual(CLAIMS);
    expect(results.map((r) => r.claimId)).toEqual(claims.map((c) => c.id));
    for (const r of results) {
      const want = EXPECTED[r.claimId]!;
      expect(r.verdict, r.claimId).toBe(want.final);
      const agents = new Set(steps.filter((s) => s.claimId === r.claimId).map((s) => s.agent));
      expect([...agents], r.claimId).toEqual(want.agent ? [want.agent] : []);
    }
    // c2 was settled by the investigator: one recorded change.
    expect(results.find((r) => r.claimId === "c2")?.history).toEqual([
      expect.objectContaining({ from: "Insufficient", to: "Supported", by: "investigator" }),
    ]);
    // c3 survived the skeptic: no change recorded.
    expect(results.find((r) => r.claimId === "c3")?.history).toEqual([]);
  });

  it("the excluded camera never counts and its request is rejected", async () => {
    const manifest = await json("manifest.json", SceneManifestSchema);
    const results = await json("results.json", z.array(ClaimResultS));
    const steps = await jsonl("agent-steps.jsonl", AgentStepS);
    const excluded = new Set(manifest.excludedCameras);
    expect(excluded.size).toBeGreaterThan(0);

    for (const r of results) expect(r.evidence.filter((e) => excluded.has(e.camera))).toEqual([]);
    const onExcluded = steps.filter((s) => "camera_id" in s.args && excluded.has(s.args.camera_id));
    expect(onExcluded.length).toBeGreaterThan(0);
    for (const s of onExcluded) expect(s).toMatchObject({ action: "rejected", rejectionReason: expect.stringMatching(/not available/) });
  });

  it("scripts/build-replay.ts reproduces every file exactly", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "rashomon-replay-test-"));
    try {
      vi.resetModules(); // the builder re-imports everything with its own temp DATA_DIR
      const { buildReplay } = await import("@/scripts/build-replay");
      await buildReplay(out);
      for (const f of REPLAY_FILES) {
        expect(await readFile(path.join(out, f), "utf8"), f).toBe(await read(f));
      }
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
