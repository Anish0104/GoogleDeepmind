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

/** Warehouse loading-dock near miss (Q1-Q6). Each text states when to answer yes and when no. */
export const WAREHOUSE_QUESTIONS: Question[] = [
  q("pedestrian", "state", "inside crossing",
    "Is the pedestrian (the person figure) standing inside the marked crossing, between the two parallel yellow lines on the floor? " +
      "Yes only if their feet are between the lines; no if they are outside the lines."),
  q("forklift", "state", "at entry line",
    "Are the tips of the forklift's forks at the nearer yellow line of the crossing, touching it or within a hand's width of it? " +
      "Yes only if the fork tips are at the line; no if the forklift is clearly further back."),
  q("forklift", "state", "past entry line",
    "Has any part of the forklift (forks or body) gone past the nearer yellow line into the crossing? " +
      "Yes only if part of it is clearly over the line; no if it stops at or before the line."),
  q("forklift", "state", "stationary",
    "Does the forklift stay completely still for the whole clip? " +
      "Yes only if its position does not change at all; no if it moves even slightly."),
  q("pedestrian", "visible", "yes",
    "Can you see the pedestrian (the person figure) in this view? No if they are out of frame or hidden behind something."),
  q("forklift", "visible", "yes",
    "Can you see the forklift in this view? No if it is out of frame or hidden behind something."),
];

/** Questions about motion, asked over a ~2 s clip instead of one 0.5 s slice. */
export const WAREHOUSE_MOTION_QUESTION_IDS = ["forklift:state:stationary"];

/**
 * NVIDIA SDG-Warehouse forklift-human near miss: open floor (no crossing lines), a forklift drives at a
 * worker who dodges or is hit. Ids match the answer key in lib/capture/sdgTruth.ts.
 */
export const SDG_NEARMISS_QUESTIONS: Question[] = [
  q("worker", "visible", "yes",
    "Can you see the worker (the person) in this view? Yes if a clear part of their body is visible; " +
      "no if they are out of frame or hidden behind the forklift or anything else."),
  q("forklift", "visible", "yes",
    "Can you see the forklift in this view? Yes if a clear part of it is visible; no if it is out of frame or hidden."),
  q("forklift", "state", "near worker",
    "Is any part of the forklift (body, mast or forks) within about one metre, roughly an arm's length, of the worker? " +
      "Yes only if they are that close; no if there is clearly more space between them."),
  q("forklift", "state", "touching worker",
    "Is the forklift touching the worker, with no gap between any part of the forklift and the person? " +
      "Yes only if they are in contact; no if there is any visible gap."),
  q("forklift", "state", "moving",
    "Does the forklift move during this clip? Yes if its position changes; no if it stays completely still."),
  q("worker", "state", "dodging",
    "Does the worker suddenly step, jump or run out of the way during this clip? " +
      "Yes only for a sudden fast movement; no if they stand still or walk calmly."),
];

/** Motion questions for the near-miss set, asked over a ~2 s clip. */
export const SDG_NEARMISS_MOTION_QUESTION_IDS = ["forklift:state:moving", "worker:state:dodging"];

export const QUESTION_SETS: Record<string, Question[]> = {
  warehouse: WAREHOUSE_QUESTIONS,
  "sdg-nearmiss": SDG_NEARMISS_QUESTIONS,
};
