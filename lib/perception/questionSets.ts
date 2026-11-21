// OWNER: Dev 1. Fixed, scene-specific question sets used instead of scout's generic mat questions.
// Ids follow scout's "<entityId>:<predicate>:<value>" format so the grid and inference code trace
// each row to its object, and every object has a "visible" question for pVisible.
import type { Question } from "@/lib/types";

const q = (entityId: string, predicate: Question["predicate"], value: string, text: string): Question => ({
  id: `${entityId}:${predicate}:${value.replace(/\s+/g, "_")}`,
  entityId,
  predicate,
  value,
  text,
});

/** Warehouse loading-dock near miss (Q1-Q6). */
export const WAREHOUSE_QUESTIONS: Question[] = [
  q("pedestrian", "state", "inside crossing", "Is the pedestrian inside the marked crossing, between the two yellow lines?"),
  q("forklift", "state", "at entry line", "Has the front of the forklift (the fork tips) reached the crossing's entry line?"),
  q("forklift", "state", "past entry line", "Has any part of the forklift crossed over the entry line into the crossing?"),
  q("forklift", "state", "stationary", "Is the forklift stationary (not moving) in this clip?"),
  q("pedestrian", "visible", "yes", "Is the pedestrian clearly visible in this view (in frame and not blocked)?"),
  q("forklift", "visible", "yes", "Is the forklift clearly visible in this view (in frame and not blocked)?"),
];

export const QUESTION_SETS: Record<string, Question[]> = { warehouse: WAREHOUSE_QUESTIONS };
