// OWNER: Dev 1. Decision 1 grid: one call per camera per slice answers every question.
// Rows are appended to grid.jsonl as they arrive so the board fills live.
// pVisible for a row is pYes of its entity's "visible" question in the same slice and camera.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GridRow, Question } from "@/lib/types";
import type { Slice } from "@/lib/capture/slice";
import { decide, mediaPart, textPart, type DecisionQuestion } from "@/lib/gemini/client";
import { appendJsonl } from "@/lib/store/scene";
import { concat } from "@/lib/video/ffmpeg";

export const LATTICE_MAX_QUESTIONS = 100;

export interface LatticeOptions {
  /** Append rows to grid.jsonl (default true). Kill tests turn this off. */
  write?: boolean;
  maxQuestionsPerCall?: number;
  /** Questions that need motion (e.g. "is it stationary?") are asked about a longer clip instead. */
  contextQuestionIds?: string[];
  /** lattice(): the longer clip for this slice. latticeScene() builds it when contextQuestionIds is set. */
  contextPath?: string;
  /** latticeScene(): slices per context clip, starting one slice before (default 4 = 2 s). */
  contextSlices?: number;
  /**
   * latticeScene(): every slice of the scene, to build context clips from when only some slices are
   * scored (e.g. every other one). Defaults to the scored slices.
   */
  contextFrom?: Slice[];
}

const Answers = z.record(z.string(), z.number().min(0).max(1));

const visibleId = (entityId: string) => `${entityId}:visible:yes`;

/** Each entity's visibility question (made up if scout didn't ask one), plus its other questions. */
function groupByEntity(questions: Question[]): { entityId: string; visible: DecisionQuestion; rest: DecisionQuestion[] }[] {
  const groups = new Map<string, { visible?: DecisionQuestion; rest: DecisionQuestion[] }>();
  for (const q of questions) {
    const g = groups.get(q.entityId) ?? { rest: [] };
    const dq: DecisionQuestion = { id: q.id, text: q.text, kind: "noul" };
    if (q.predicate === "visible" && !g.visible) g.visible = dq;
    else g.rest.push(dq);
    groups.set(q.entityId, g);
  }
  return [...groups].map(([entityId, g]) => ({
    entityId,
    visible: g.visible ?? {
      id: visibleId(entityId),
      kind: "noul",
      text: `Is the ${entityId.replace(/_/g, " ")} clearly visible in this view (in frame and not blocked)?`,
    },
    rest: g.rest,
  }));
}

/** Packs entity groups into calls of at most `max` questions; a group never loses its visibility question. */
function batches(groups: ReturnType<typeof groupByEntity>, max: number): DecisionQuestion[][] {
  const out: DecisionQuestion[][] = [];
  let cur: DecisionQuestion[] = [];
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const g of groups) {
    let rest = g.rest;
    while (true) {
      const room = max - cur.length - 1;
      if (room < 1 && cur.length) {
        flush();
        continue;
      }
      cur.push(g.visible, ...rest.slice(0, Math.max(1, room)));
      rest = rest.slice(Math.max(1, room));
      if (rest.length === 0) break;
      flush();
    }
  }
  flush();
  return out;
}

export async function lattice(slice: Slice, questions: Question[], sceneId: string, opts: LatticeOptions = {}): Promise<GridRow[]> {
  if (questions.length === 0) return [];
  const groups = groupByEntity(questions);
  const video = mediaPart((await readFile(slice.path)).toString("base64"), "video/mp4");
  const context = textPart(
    `Half-second video slice from camera ${slice.camera}. ` +
      `Answer each question only from what this camera shows in this slice.`,
  );

  const onContext = new Set(opts.contextPath ? (opts.contextQuestionIds ?? []) : []);
  const sliceGroups = groups.map((g) => ({ ...g, rest: g.rest.filter((q) => !onContext.has(q.id)) }));

  const p: Record<string, number> = {};
  for (const qs of batches(sliceGroups, opts.maxQuestionsPerCall ?? LATTICE_MAX_QUESTIONS)) {
    Object.assign(p, Answers.parse(await decide([video, context], qs, { purpose: "lattice", sceneId })));
  }

  const contextQs = questions.filter((q) => onContext.has(q.id)).map((q): DecisionQuestion => ({ id: q.id, text: q.text, kind: "noul" }));
  if (contextQs.length && opts.contextPath) {
    const clip = mediaPart((await readFile(opts.contextPath)).toString("base64"), "video/mp4");
    const note = textPart(
      `Short video clip from camera ${slice.camera} spanning about two seconds around this moment. ` +
        `Answer each question about what happens during this clip.`,
    );
    Object.assign(p, Answers.parse(await decide([clip, note], contextQs, { purpose: "lattice", sceneId })));
  }

  const visibleOf = new Map(groups.map((g) => [g.entityId, p[g.visible.id]!]));

  const rows: GridRow[] = questions.map((q) => {
    const pYes = p[q.id];
    if (pYes === undefined) throw new Error(`lattice: no answer for ${q.id}`);
    return { sceneId, camera: slice.camera, t: slice.t, questionId: q.id, pYes, pVisible: visibleOf.get(q.entityId)! };
  });
  if (opts.write !== false) for (const r of rows) await appendJsonl(sceneId, "grid.jsonl", r);
  return rows;
}

/** Runs lattice() over every slice in parallel (bounded by MAX_CONCURRENT_CALLS). */
export async function latticeScene(
  slices: Slice[],
  questions: Question[],
  sceneId: string,
  onRows?: (rows: GridRow[]) => void,
  opts: LatticeOptions = {},
): Promise<GridRow[]> {
  const errors: Error[] = [];
  const needsContext = (opts.contextQuestionIds ?? []).length > 0;
  const span = Math.max(2, opts.contextSlices ?? 4);
  const byCamera = new Map<string, Slice[]>();
  for (const s of [...(opts.contextFrom ?? slices)].sort((a, b) => a.t - b.t)) byCamera.set(s.camera, [...(byCamera.get(s.camera) ?? []), s]);

  /** Joins the slice before this one and the ones after it into one clip, cached next to the slices. */
  const contextFor = async (s: Slice): Promise<string> => {
    const list = byCamera.get(s.camera)!;
    const k = list.findIndex((x) => x.path === s.path);
    if (k < 0) throw new Error(`slice ${s.path} is not in contextFrom`);
    const out = path.join(path.dirname(s.path), `ctx${span}-${path.basename(s.path)}`);
    if (!existsSync(out)) await concat(list.slice(Math.max(0, k - 1), Math.min(list.length, k - 1 + span)).map((x) => x.path), out);
    return out;
  };

  const results = await Promise.all(
    slices.map((s) =>
      (needsContext ? contextFor(s).then((contextPath) => ({ ...opts, contextPath })) : Promise.resolve(opts))
        .then((o) => lattice(s, questions, sceneId, o))
        .then(
        (rows) => {
          onRows?.(rows);
          return rows;
        },
        (e: unknown) => {
          errors.push(e instanceof Error ? e : new Error(String(e)));
          return [] as GridRow[];
        },
      ),
    ),
  );
  if (slices.length > 0 && errors.length === slices.length) {
    throw new Error(`lattice failed on every slice: ${errors[0]!.message}`);
  }
  if (errors.length) console.warn(`[lattice] ${errors.length}/${slices.length} slices failed; first: ${errors[0]!.message}`);
  return results.flat().sort((a, b) => a.t - b.t || a.camera.localeCompare(b.camera));
}
