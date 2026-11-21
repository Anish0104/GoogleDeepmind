// OWNER: Dev 2. Grid cleaning and value normalisation shared by evidence.ts, state.ts and fake-grid.ts.
// Grid rows come from model output (Dev 1's lattice), so bad rows are dropped and counted, never coerced.
import type { CameraId, GridRow, Question, Zone } from "@/lib/types";
import { LIMITS, ZONES } from "@/lib/config";

export const CAMERA_IDS: readonly CameraId[] = ["A", "B", "C", "D"];
export const PREDICATES: readonly Question["predicate"][] = ["location", "heldBy", "state", "visible"];

/** Event values that mean "the state is not known". "none" is NOT unknown: it is a real heldBy value. */
const UNKNOWN_TOKENS = new Set(["", "unknown", "?"]);

/** Lowercase, trim, collapse whitespace, drop punctuation other than hyphens and apostrophes. */
export function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "C", "c", "zone C" -> "C"; anything else -> null. */
export function toZone(v: string): Zone | null {
  const m = /^(?:zone\s+)?([a-z])$/i.exec(v.trim().replace(/\s+/g, " "));
  const z = m?.[1]?.toUpperCase();
  return z !== undefined && (ZONES as readonly string[]).includes(z) ? (z as Zone) : null;
}

/** Canonical form of a question or event value: zone letters for location, normText otherwise. */
export function normValue(predicate: Question["predicate"], v: string): string {
  if (predicate === "location") return toZone(v) ?? normText(v);
  return normText(v);
}

export function isUnknownValue(v: string): boolean {
  return UNKNOWN_TOKENS.has(normText(v));
}

/** A grid row covers [t, t + SLICE_S). */
export function sliceWindow(t: number): [number, number] {
  return [t, t + LIMITS.SLICE_S];
}

export interface GridCell {
  camera: CameraId;
  t: number;
  questionId: string;
  pYes: number;
  pVisible: number;
}

export interface GridIndex {
  cells: GridCell[]; // sorted by t, camera, questionId
  sceneIds: Set<string>;
  dropped: { malformed: number; conflicting: number; otherScene: number };
}

const prob = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

function isValidRow(r: unknown): r is GridRow {
  if (typeof r !== "object" || r === null) return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.sceneId === "string" &&
    x.sceneId !== "" &&
    typeof x.camera === "string" &&
    (CAMERA_IDS as readonly string[]).includes(x.camera) &&
    typeof x.t === "number" &&
    Number.isFinite(x.t) &&
    x.t >= 0 &&
    typeof x.questionId === "string" &&
    x.questionId !== "" &&
    prob(x.pYes) &&
    prob(x.pVisible)
  );
}

/**
 * Validates and de-duplicates grid rows. One cell per (camera, questionId, t):
 * identical duplicates collapse to one (duplication never adds weight); duplicates that
 * disagree are all dropped, since we cannot tell which is right.
 */
export function indexGrid(rows: readonly GridRow[], sceneId?: string): GridIndex {
  const dropped = { malformed: 0, conflicting: 0, otherScene: 0 };
  const sceneIds = new Set<string>();
  const byKey = new Map<string, { cell: GridCell; copies: number; conflict: boolean }>();

  for (const r of rows) {
    if (!isValidRow(r)) {
      dropped.malformed++;
      continue;
    }
    if (sceneId !== undefined && r.sceneId !== sceneId) {
      dropped.otherScene++;
      continue;
    }
    sceneIds.add(r.sceneId);
    const key = `${r.sceneId}\u0000${r.camera}\u0000${r.questionId}\u0000${r.t}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        cell: { camera: r.camera, t: r.t, questionId: r.questionId, pYes: r.pYes, pVisible: r.pVisible },
        copies: 1,
        conflict: false,
      });
    } else {
      prev.copies++;
      if (prev.cell.pYes !== r.pYes || prev.cell.pVisible !== r.pVisible) prev.conflict = true;
    }
  }

  const cells: GridCell[] = [];
  for (const { cell, copies, conflict } of byKey.values()) {
    if (conflict) dropped.conflicting += copies;
    else cells.push(cell);
  }
  cells.sort(
    (a, b) =>
      a.t - b.t ||
      CAMERA_IDS.indexOf(a.camera) - CAMERA_IDS.indexOf(b.camera) ||
      (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0),
  );
  return { cells, sceneIds, dropped };
}

function sameQuestion(a: Question, b: Question): boolean {
  return a.entityId === b.entityId && a.predicate === b.predicate && a.value === b.value && a.text === b.text;
}

/** Questions by id. Invalid questions and ids whose duplicates disagree are dropped. */
export function indexQuestions(questions: readonly Question[]): Map<string, Question> {
  const out = new Map<string, Question>();
  const bad = new Set<string>();
  for (const q of questions) {
    const valid =
      typeof q === "object" &&
      q !== null &&
      typeof q.id === "string" &&
      q.id !== "" &&
      typeof q.entityId === "string" &&
      q.entityId !== "" &&
      PREDICATES.includes(q.predicate) &&
      typeof q.value === "string" &&
      typeof q.text === "string";
    if (!valid) continue;
    const prev = out.get(q.id);
    if (prev && !sameQuestion(prev, q)) bad.add(q.id);
    else if (!prev) out.set(q.id, q);
  }
  for (const id of bad) out.delete(id);
  return out;
}
