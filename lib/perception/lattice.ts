// OWNER: Dev 1. Decision 1 grid: one call per camera per slice answers every question.
// Rows are appended to grid.jsonl as they arrive so the board fills live.
import type { GridRow, Question } from "@/lib/types";
import type { Slice } from "@/lib/capture/slice";
import { notImplemented } from "@/lib/not-implemented";

export async function lattice(_slice: Slice, _questions: Question[], _sceneId: string): Promise<GridRow[]> {
  return notImplemented("Dev 1", "lattice");
}

/** Runs lattice() over every slice in parallel (bounded by MAX_CONCURRENT_CALLS). */
export async function latticeScene(
  _slices: Slice[],
  _questions: Question[],
  _sceneId: string,
  _onRows?: (rows: GridRow[]) => void,
): Promise<GridRow[]> {
  return notImplemented("Dev 1", "latticeScene");
}
