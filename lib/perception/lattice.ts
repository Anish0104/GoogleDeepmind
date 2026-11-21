// OWNER: Dev 1. Decision 1 grid: one call per camera per slice answers every question.
// Rows are appended to grid.jsonl as they arrive so the board fills live.
// pVisible for a row is pYes of its entity's "visible" question in the same slice and camera.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { GridRow, Question } from "@/lib/types";
import type { Slice } from "@/lib/capture/slice";
import { decide, mediaPart, textPart, type DecisionQuestion } from "@/lib/gemini/client";
import { appendJsonl } from "@/lib/store/scene";

export const LATTICE_MAX_QUESTIONS = 100;

export interface LatticeOptions {
  /** Append rows to grid.jsonl (default true). Kill tests turn this off. */
  write?: boolean;
  maxQuestionsPerCall?: number;
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
    `Half-second video slice from camera ${slice.camera} filming a tabletop mat with six printed zones A-F. ` +
      `Answer each question only from what this camera shows in this slice.`,
  );

  const p: Record<string, number> = {};
  for (const qs of batches(groups, opts.maxQuestionsPerCall ?? LATTICE_MAX_QUESTIONS)) {
    Object.assign(p, Answers.parse(await decide([video, context], qs, { purpose: "lattice", sceneId })));
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
  const results = await Promise.all(
    slices.map((s) =>
      lattice(s, questions, sceneId, opts).then(
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
