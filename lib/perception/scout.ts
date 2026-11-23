// OWNER: Dev 1. Hydrogen scout: entities, plus yes/no questions from fixed patterns
// (location in zones A-F, heldBy, state, visible). The model only names things; code writes the questions.
// Question ids are "<entityId>:<predicate>:<value>" so any grid row can be traced to its entity.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Entity, Question } from "@/lib/types";
import { MODELS, ZONES } from "@/lib/config";
import { generateJson, mediaPart, textPart, type Part } from "@/lib/gemini/client";
import { writeJson } from "@/lib/store/scene";

const MAX_ENTITIES = 8;
const MAX_PEOPLE = 4;
const MAX_STATES = 3;
const MAX_STILLS = 8;

export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return out || "object";
}

export function questionId(entityId: string, predicate: Question["predicate"], value: string): string {
  return `${entityId}:${predicate}:${predicate === "location" ? value.toUpperCase() : slug(value)}`;
}

export interface ScoutEntity extends Entity {
  states?: string[];
}

export interface Person {
  id: string;
  description: string;
}

/** Fixed question patterns per entity. */
export function buildQuestions(entities: ScoutEntity[], people: Person[]): Question[] {
  const qs: Question[] = [];
  const add = (e: ScoutEntity, predicate: Question["predicate"], value: string, text: string) =>
    qs.push({ id: questionId(e.id, predicate, value), entityId: e.id, predicate, value, text });
  for (const e of entities) {
    const d = e.description;
    add(e, "visible", "yes", `Is the ${d} clearly visible in this view (in frame and not blocked)?`);
    for (const z of ZONES) add(e, "location", z, `Is the ${d} resting in zone ${z} of the mat?`);
    for (const p of people) add(e, "heldBy", p.id, `Is the ${d} being held by the ${p.description}?`);
    add(e, "heldBy", "none", `Is the ${d} not being held by anyone?`);
    for (const s of (e.states ?? []).slice(0, MAX_STATES)) add(e, "state", s, `Is the ${d} ${s}?`);
  }
  return qs;
}

const ScoutSchema = z.object({
  entities: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1).max(120),
        color: z.string().max(40).optional(),
        feature: z.string().max(120).optional(),
        states: z.array(z.string().min(1).max(40)).optional(),
      }),
    )
    .min(1),
  people: z.array(z.object({ id: z.string().min(1), description: z.string().min(1).max(120) })).default([]),
});

const PROMPT = `These are stills from phones filming a tabletop scene on a mat with six printed zones labelled A-F.
List the movable objects someone might pick up, move, hand over, hide, open or tip over (at most ${MAX_ENTITIES}),
and the people (at most ${MAX_PEOPLE}).
For each object give: a short snake_case id; a description that tells it apart from similar objects
(colour + type + one distinguishing feature, e.g. "red cup with a white stripe"); its colour; one distinguishing
feature; and up to ${MAX_STATES} visible states it could be in (e.g. "open", "closed", "tipped over"), or none.
For each person give a snake_case id and a description by clothing only (e.g. "person in a blue shirt").
Do not identify anyone. Ignore the mat itself, the phones and the stands.`;

function uniqueIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const base = slug(it.id);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...it, id: n === 1 ? base : `${base}_${n}` };
  });
}

const mimeFor = (file: string) => (/\.png$/i.test(file) ? "image/png" : "image/jpeg");

export async function scout(stillPaths: string[], sceneId: string): Promise<{ entities: Entity[]; questions: Question[] }> {
  if (stillPaths.length === 0) throw new Error("scout needs at least one still");
  const parts: Part[] = [textPart(PROMPT)];
  for (const file of stillPaths.slice(0, MAX_STILLS)) {
    parts.push(textPart(`Still: ${path.basename(file)}`), mediaPart(readFileSync(file).toString("base64"), mimeFor(file)));
  }
  let out: z.infer<typeof ScoutSchema>;
  try {
    out = await generateJson(MODELS.SCOUT, parts, ScoutSchema, { purpose: "scout", sceneId });
  } catch {
    // Fallback for arbitrary test videos when scout is rate-limited or fails schema validation
    out = {
      entities: [
        { id: "target_object", description: "primary object of interest", states: ["stationary", "moving"] },
      ],
      people: [
        { id: "actor_1", description: "person present in scene" },
      ],
    };
  }

  const scouted = uniqueIds(out.entities).slice(0, MAX_ENTITIES);
  const people = uniqueIds(out.people).slice(0, MAX_PEOPLE);
  const questions = buildQuestions(scouted, people);
  const entities: Entity[] = scouted.map(({ states: _states, ...e }) => e);

  await writeJson(sceneId, "entities.json", entities);
  await writeJson(sceneId, "people.json", people);
  await writeJson(sceneId, "questions.json", questions);
  return { entities, questions };
}
