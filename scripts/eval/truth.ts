// OWNER: Dev 3. The warehouse answer key: data/labels/<sceneId>.truth.json (from NVIDIA PhysicalAI SDG-Warehouse,
// forklift_human_nearmiss). ONLY scripts/eval reads it; tests/answer-key-guard.test.ts enforces that nothing that
// labels claims (lib/, app/) reads data/labels or imports scripts/eval.
//
// Times are seconds on the scene's timeline (the scenes are presynced). Some files lack summary.near and
// summary.forkliftStopT: a missing forkliftStopT means the forklift never stopped (null); statements that need
// any other missing field are skipped by the account builder.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DATA_DIR } from "@/lib/config";

const Window = z.tuple([z.number(), z.number()]);
const Answer = z.enum(["yes", "no", "unclear"]); // unclear = don't score
const Camera = z.enum(["A", "B", "C", "D"]);

const CameraEntry = z.looseObject({
  alias: z.string().optional(),
  "worker:visible:yes": Answer.optional(),
  "forklift:visible:yes": Answer.optional(),
});

export const TruthSliceSchema = z.looseObject({
  t: z.number(), // slice start; a slice covers [t, t + 0.5)
  window: Window.optional(), // the 2 s span the motion questions look at
  gapMinM: z.number().optional(),
  gapMaxM: z.number().optional(),
  answers: z.record(z.string(), Answer).optional(),
  cameras: z.partialRecord(Camera, CameraEntry).default({}),
});

export const TruthSummarySchema = z.looseObject({
  durationS: z.number().positive(),
  outcome: z.enum(["contact", "near_miss"]),
  contact: Window.nullable().optional(), // first/last time touching; null for a near miss
  minGapM: z.number().optional(),
  minGapT: z.number().optional(),
  near: Window.nullable().optional(),
  dodgeStartT: z.number().nullable().optional(),
  forkliftStopT: z.number().nullable().optional(),
});

export const TruthSchema = z.looseObject({
  source: z.string().optional(),
  runId: z.string().optional(),
  sceneId: z.string().min(1),
  presynced: z.boolean().optional(),
  views: z.partialRecord(Camera, z.string()).optional(),
  summary: TruthSummarySchema,
  slices: z.array(TruthSliceSchema),
});

export type Truth = z.infer<typeof TruthSchema>;
export type TruthSlice = z.infer<typeof TruthSliceSchema>;

/** The answer-key path for a scene. */
export function truthPath(sceneId: string, dataDir: string = DATA_DIR): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(sceneId)) throw new Error(`Invalid scene id ${JSON.stringify(sceneId)}.`);
  return path.resolve(dataDir, "labels", `${sceneId}.truth.json`);
}

/** Reads and validates data/labels/<sceneId>.truth.json. */
export async function readTruth(sceneId: string, dataDir: string = DATA_DIR): Promise<Truth> {
  const file = truthPath(sceneId, dataDir);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`Could not read the answer key ${file}: ${(e as Error).message}`);
  }
  const parsed = TruthSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Answer key ${file} is malformed: ${z.prettifyError(parsed.error)}`);
  if (parsed.data.sceneId !== sceneId) throw new Error(`Answer key ${file} is for scene ${parsed.data.sceneId}, not ${sceneId}.`);
  return parsed.data;
}
