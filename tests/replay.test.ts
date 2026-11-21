// OWNER: Dev 3. The sample replay in fixtures/replay/demo-scene/: every file parses with the shared types,
// the four claims tell the intended story, and scripts/build-replay.ts reproduces it (numbers within 1e-9).
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

// ---------- structural comparison (platform float noise in the last digits is not a difference) ----------
const NUM_TOL = 1e-9;

const parseFile = (f: string, text: string): unknown =>
  f.endsWith(".jsonl")
    ? text
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l) as unknown)
    : (JSON.parse(text) as unknown);

/** Every path where a and b differ: numbers within NUM_TOL count as equal; all else must match exactly. */
function diffClose(a: unknown, b: unknown, at = "$"): string[] {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= NUM_TOL ? [] : [`${at}: ${a} != ${b}`];
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [`${at}: array vs non-array`];
    if (a.length !== b.length) return [`${at}: length ${a.length} != ${b.length}`];
    return a.flatMap((x, i) => diffClose(x, b[i], `${at}[${i}]`));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return [`${at}: keys [${ka.join()}] != [${kb.join()}]`];
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.flatMap((k) => diffClose(ra[k], rb[k], `${at}.${k}`));
  }
  return Object.is(a, b) ? [] : [`${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

describe("diffClose (test helper)", () => {
  it("ignores float noise in the last digits, as seen between macOS and Linux", () => {
    expect(diffClose({ pYes: 0.0418943349965123 }, { pYes: 0.041894334996512295 })).toEqual([]);
  });

  it("reports real differences with their path", () => {
    expect(diffClose({ a: [1, { b: 0.5 }] }, { a: [1, { b: 0.5001 }] })).toEqual(["$.a[1].b: 0.5 != 0.5001"]);
    expect(diffClose({ v: "Supported" }, { v: "Insufficient" })).toEqual(['$.v: "Supported" != "Insufficient"']);
    expect(diffClose({ a: 1 }, { a: 1, b: 2 })).toHaveLength(1);
    expect(diffClose([1, 2], [1])).toHaveLength(1);
    expect(diffClose({ s: null }, { s: 0 })).toHaveLength(1);
  });
});

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

  it("stores grid probabilities rounded to 6 decimal places", async () => {
    for (const r of await jsonl("grid.jsonl", GridRowS)) {
      expect(Math.round(r.pYes * 1e6) / 1e6).toBe(r.pYes);
      expect(Math.round(r.pVisible * 1e6) / 1e6).toBe(r.pVisible);
    }
  });

  it("scripts/build-replay.ts reproduces every file (numbers within 1e-9, everything else exact)", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "rashomon-replay-test-"));
    try {
      vi.resetModules(); // the builder re-imports everything with its own temp DATA_DIR
      const { buildReplay } = await import("@/scripts/build-replay");
      await buildReplay(out);
      for (const f of REPLAY_FILES) {
        const rebuilt = parseFile(f, await readFile(path.join(out, f), "utf8"));
        const stored = parseFile(f, await read(f));
        expect(diffClose(rebuilt, stored, f), f).toEqual([]);
      }
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
