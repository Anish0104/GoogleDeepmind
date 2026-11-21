// OWNER: Dev 1. Fixed, scene-specific question sets used instead of scout's generic mat questions.
// Ids follow scout's "<entityId>:<predicate>:<value>" format so the grid and inference code trace
// each row to its object, and every object has a "visible" question for pVisible.
import type { Entity, Question } from "@/lib/types";
import type { Person } from "@/lib/perception/scout";

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
    "Does any part of the forklift touch the worker at any moment in this slice, with no gap between them? " +
      "Yes if they are in contact at any point; no if there is a visible gap the whole time."),
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

/**
 * Each set's registry, written to entities.json / people.json instead of scout's, so the entity ids
 * in questions.json match the ones Dev 2's grounding looks up. Descriptions are generic: appearance
 * varies between runs.
 */
export const QUESTION_SET_ENTITIES: Record<string, Entity[]> = {
  warehouse: [
    { id: "pedestrian", description: "pedestrian: the person figure on the warehouse floor" },
    { id: "forklift", description: "forklift with a mast and two forks", feature: "mast and forks" },
  ],
  "sdg-nearmiss": [
    { id: "worker", description: "worker: the person standing on the warehouse floor" },
    { id: "forklift", description: "forklift: a stand-up warehouse forklift with a mast and two forks", feature: "mast and forks" },
  ],
};

export const QUESTION_SET_PEOPLE: Record<string, Person[]> = {
  warehouse: [{ id: "pedestrian", description: "the pedestrian on the warehouse floor" }],
  "sdg-nearmiss": [{ id: "worker", description: "the worker on the warehouse floor" }],
};

/** Question ids each set asks over a ~2 s clip; perceiveScene() passes them to the lattice as contextQuestionIds. */
export const QUESTION_SET_MOTION_IDS: Record<string, string[]> = {
  warehouse: WAREHOUSE_MOTION_QUESTION_IDS,
  "sdg-nearmiss": SDG_NEARMISS_MOTION_QUESTION_IDS,
};

/**
 * Pairs of state questions that can never both be true: same entity, same window (both on the 0.5 s
 * slice or both on the 2 s clip), and each is the other's exact negation. Dev 2's evidence may treat
 * one as the alternative of the other, so a state claim can be contradicted.
 */
//
// sdg-nearmiss has none for now: its opposites (clear_of_worker, stopped) scored high during real
// contact and real motion, so a false "it never touched me" / "it stopped" could be Supported. They
// were removed until a wording is validated against the answer keys.
export const QUESTION_SET_EXCLUSIVE: Record<string, [string, string][]> = {
  "sdg-nearmiss": [],
};

export interface QuestionSet {
  name: string;
  questions: Question[];
  entities: Entity[];
  people: Person[];
  motionIds: string[];
}

/** Everything perceiveScene() needs for a named set; throws on an unknown name. */
export function questionSet(name: string): QuestionSet {
  const questions = QUESTION_SETS[name];
  if (!questions) throw new Error(`unknown question set "${name}" (known: ${Object.keys(QUESTION_SETS).join(", ")})`);
  return {
    name,
    questions,
    entities: QUESTION_SET_ENTITIES[name] ?? [],
    people: QUESTION_SET_PEOPLE[name] ?? [],
    motionIds: QUESTION_SET_MOTION_IDS[name] ?? [],
  };
}
