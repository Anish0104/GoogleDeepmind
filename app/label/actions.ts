// OWNER: Dev 4. Server actions for the labeling tool. Each labeler's submission is saved
// on its own; once two labelers have submitted a scene, their calls are merged into the
// ground-truth file (agreement -> that label, disagreement -> "Ambiguous").
"use server";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import type { GroundTruthItem, Verdict } from "@/lib/types";

const LABELS_DIR = path.join(DATA_DIR, "labels");

export interface LabelEntry {
  claimId: string;
  label: Verdict;
  note?: string;
}

export interface LabelerSubmission {
  sceneId: string;
  labeler: string;
  at: string;
  entries: LabelEntry[];
}

export interface SaveResult {
  ok: boolean;
  message: string;
}

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** A per-labeler file is "<sceneId>__<labelerSlug>.json"; the merged truth is "<sceneId>.json". */
const perLabelerName = (sceneId: string, labeler: string) => `${sceneId}__${slug(labeler)}.json`;

async function listPerLabelerFiles(sceneId: string): Promise<string[]> {
  try {
    const files = await readdir(LABELS_DIR);
    return files.filter((f) => f.startsWith(`${sceneId}__`) && f.endsWith(".json"));
  } catch {
    return [];
  }
}

/** Merge every per-labeler submission for a scene into GroundTruthItem[] (needs >= 2 labelers). */
async function mergeScene(sceneId: string): Promise<number> {
  const files = await listPerLabelerFiles(sceneId);
  const subs: LabelerSubmission[] = [];
  for (const f of files) {
    try {
      subs.push(JSON.parse(await readFile(path.join(LABELS_DIR, f), "utf8")) as LabelerSubmission);
    } catch {
      /* skip unreadable */
    }
  }
  if (subs.length < 2) return subs.length;

  subs.sort((a, b) => a.at.localeCompare(b.at));
  const [a, b] = subs;
  const mapB = new Map(b!.entries.map((e) => [e.claimId, e]));
  const claimIds = [...new Set([...a!.entries, ...b!.entries].map((e) => e.claimId))];

  const merged: GroundTruthItem[] = claimIds.map((claimId) => {
    const ea = a!.entries.find((e) => e.claimId === claimId);
    const eb = mapB.get(claimId);
    const agreed = ea && eb && ea.label === eb.label;
    const note = [ea?.note, eb?.note].filter(Boolean).join(" | ") || undefined;
    return {
      sceneId,
      claimId,
      label: agreed ? ea!.label : "Ambiguous",
      labelerA: a!.labeler,
      labelerB: b!.labeler,
      note,
    };
  });

  await writeFile(
    path.join(LABELS_DIR, `${sceneId}.json`),
    JSON.stringify(merged, null, 2) + "\n",
    "utf8",
  );
  return subs.length;
}

/** Save one labeler's labels for a scene, then merge if a second labeler exists. */
export async function saveLabeling(input: LabelerSubmission): Promise<SaveResult> {
  const sceneId = path.basename(input.sceneId);
  if (!sceneId || !slug(input.labeler)) {
    return { ok: false, message: "A scene and a labeler name are required." };
  }
  if (input.entries.length === 0) {
    return { ok: false, message: "Label at least one claim before saving." };
  }

  await mkdir(LABELS_DIR, { recursive: true });
  const submission: LabelerSubmission = { ...input, sceneId, at: new Date().toISOString() };
  await writeFile(
    path.join(LABELS_DIR, perLabelerName(sceneId, input.labeler)),
    JSON.stringify(submission, null, 2) + "\n",
    "utf8",
  );

  const labelers = await mergeScene(sceneId);
  return labelers >= 2
    ? { ok: true, message: `Saved. ${labelers} labelers merged into ground truth for ${sceneId}.` }
    : { ok: true, message: `Saved. Waiting on a second labeler for ${sceneId}.` };
}
