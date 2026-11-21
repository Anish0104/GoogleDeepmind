// OWNER: Dev 2. Links a Claim's witness words to scene registry ids WITHOUT changing the Claim.
//
// Inputs are the scene files Dev 1's scout writes: entities.json (Entity[]), people.json
// (Person[]: id + appearance description) and questions.json (Question[]). The result is a separate
// ClaimGrounding whose `target` feeds evidenceForTarget(). The Claim (id, text, actor, object,
// action, window, precision) is never modified, and claims.ts is not involved.
//
// Rules (deterministic; anything uncertain stays unresolved):
// - Registries are validated with zod. Invalid entries are dropped; identical duplicates collapse;
//   entries that share an id but differ are all dropped (conflict). Missing or malformed registries
//   resolve nothing.
// - Questions count only if their entity is registered; heldBy values must be a registered person id
//   or "none"; location values must be a zone A-F. Two questions for one value are ambiguous.
// - Object: exact entity id, else every distinguishing witness word (articles and generic words like
//   "thing" removed) must appear in exactly ONE entity's description/color/feature.
// - Person: exact person id, else every distinguishing witness word (generic words like "person",
//   "man", "someone" removed) must appear in exactly ONE person's description. Scout descriptions are
//   appearance only, so a NAME never matches and is never linked to someone by clothing.
// - Actions must be the canonical strings splitClaims() produces: "move to zone X", "located in zone X",
//   "pick up", "give to <recipient>", "state <value>". Anything else is ungrounded.
// - A role that determines the target (the take actor, the give recipient) is resolved only if it maps
//   to that entity's heldBy question. The give actor is resolved against the registry only, and an
//   actor and recipient resolving to the same person is a conflict.
// - When anything fails, target is null and evidenceForTarget() returns null scores: no support or
//   contradiction is ever manufactured.
import { z } from "zod";
import type { Claim, Question } from "@/lib/types";
import type { Person } from "@/lib/perception/scout";
import { indexQuestions, normText, normValue, toZone } from "@/lib/inference/grid";
import type { EvidenceTarget } from "@/lib/inference/evidence";

/** Raw scene files as loaded; each may be missing or malformed. */
export interface SceneRegistry {
  entities?: unknown;
  people?: unknown;
  questions?: unknown;
}

export type Resolution =
  | { status: "resolved"; id: string; via: "id" | "description" }
  | { status: "unresolved"; reason: string; candidates?: string[] };

export interface ClaimGrounding {
  claimId: string;
  entity: Resolution;
  /** Present for take and give claims. */
  actor: Resolution | null;
  /** Present for give claims. */
  recipient: Resolution | null;
  /** The evidence target, or null when grounding is not reliable. */
  target: EvidenceTarget | null;
  /** Why something is unresolved, plus registry problems. */
  reasons: string[];
}

const EntitySchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().trim().min(1),
  color: z.string().optional(),
  feature: z.string().optional(),
  states: z.array(z.string()).optional(),
});
const PersonSchema = z.object({ id: z.string().trim().min(1), description: z.string().trim().min(1) });
type RegEntity = z.infer<typeof EntitySchema>;

const STOP = new Set(["the", "a", "an", "this", "that", "these", "those", "his", "her", "their", "its", "of", "in", "on", "at", "with", "wearing", "who", "wore", "was", "is", "and", "to"]);
const GENERIC_PERSON = new Set(["person", "people", "man", "men", "woman", "women", "guy", "guys", "girl", "boy", "someone", "somebody", "individual", "human"]);
const GENERIC_OBJECT = new Set(["thing", "things", "object", "objects", "item", "items", "stuff"]);

const words = (s: string) => normText(s).split(" ").filter(Boolean);
const content = (phrase: string, generic: Set<string>) => words(phrase).filter((w) => !STOP.has(w) && !generic.has(w));
const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;
const idForm = (id: string) => normText(id.replace(/[_-]+/g, " "));

/** Validates a registry list: drops invalid entries, collapses identical duplicates, drops conflicts. */
function parseList<T extends { id: string }>(raw: unknown, schema: z.ZodType<T>, name: string, reasons: string[]): T[] {
  if (raw === undefined || raw === null) {
    reasons.push(`${name} registry missing`);
    return [];
  }
  if (!Array.isArray(raw)) {
    reasons.push(`${name} registry is not a list`);
    return [];
  }
  const byId = new Map<string, T[]>();
  let invalid = 0;
  for (const item of raw) {
    const p = schema.safeParse(item);
    if (!p.success) {
      invalid++;
      continue;
    }
    const id = p.data.id.trim();
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push(p.data);
  }
  if (invalid > 0) reasons.push(`${invalid} invalid ${name} entr${invalid === 1 ? "y" : "ies"} dropped`);
  const out: T[] = [];
  for (const [id, list] of byId) {
    if (list.every((x) => JSON.stringify(x) === JSON.stringify(list[0]))) out.push(list[0]!);
    else reasons.push(`conflicting ${name} entries for id "${id}" dropped`);
  }
  return out;
}

function match<T extends { id: string }>(
  phrase: string,
  items: T[],
  text: (x: T) => string,
  generic: Set<string>,
  kind: string,
): Resolution {
  const p = normText(phrase);
  if (p === "") return { status: "unresolved", reason: `no ${kind} named` };
  const byId = items.filter((x) => normText(x.id) === p || idForm(x.id) === p);
  if (byId.length === 1) return { status: "resolved", id: byId[0]!.id, via: "id" };
  const want = content(phrase, generic);
  if (want.length === 0) return { status: "unresolved", reason: `"${phrase}" has no distinguishing words for a ${kind}` };
  const hits = items
    .filter((x) => {
      const have = words(text(x));
      return want.every((w) => have.some((h) => sameWord(w, h)));
    })
    .map((x) => x.id)
    .sort();
  if (hits.length === 1) return { status: "resolved", id: hits[0]!, via: "description" };
  if (hits.length > 1) return { status: "unresolved", reason: `"${phrase}" matches several ${kind}s`, candidates: hits };
  return { status: "unresolved", reason: `no registered ${kind} matches "${phrase}"` };
}

type Action =
  | { kind: "location"; zone: string }
  | { kind: "take" }
  | { kind: "give"; recipient: string }
  | { kind: "state"; value: string };

function parseAction(action: string): Action | null {
  const a = normText(action);
  let m = /^(?:move to|located in) zone ([a-z])$/.exec(a);
  if (m) {
    const zone = toZone(m[1]!);
    return zone ? { kind: "location", zone } : null;
  }
  if (a === "pick up") return { kind: "take" };
  m = /^give to (.+)$/.exec(a);
  if (m) return { kind: "give", recipient: m[1]! };
  m = /^state (.+)$/.exec(a);
  if (m) return { kind: "state", value: m[1]! };
  return null;
}

/** Resolves a Claim against the scene registries. Pure; never throws on bad registries. */
export function resolveGrounding(claim: Claim, registry: SceneRegistry): ClaimGrounding {
  const reasons: string[] = [];
  const entities = parseList<RegEntity>(registry?.entities, EntitySchema, "entities", reasons);
  const people = parseList<Person>(registry?.people, PersonSchema, "people", reasons);
  let rawQuestions: Question[] = [];
  if (registry?.questions === undefined || registry?.questions === null) reasons.push("questions registry missing");
  else if (!Array.isArray(registry.questions)) reasons.push("questions registry is not a list");
  else rawQuestions = registry.questions as Question[];

  const entityIds = new Set(entities.map((e) => e.id));
  const personIds = new Set(people.map((p) => p.id));
  const questions = [...indexQuestions(rawQuestions).values()].filter((q) => {
    if (!entityIds.has(q.entityId)) return false;
    if (q.predicate === "heldBy") return q.value === "none" || personIds.has(q.value);
    if (q.predicate === "location") return toZone(q.value) !== null;
    return true;
  });

  const entity = match(claim.object, entities, (e) => [e.description, e.color ?? "", e.feature ?? ""].join(" "), GENERIC_OBJECT, "object");
  const action = parseAction(claim.action);
  const person = (phrase: string) => match(phrase, people, (p) => p.description, GENERIC_PERSON, "person");

  let actor: Resolution | null = null;
  let recipient: Resolution | null = null;
  if (action?.kind === "take" || action?.kind === "give") actor = person(claim.actor);
  if (action?.kind === "give") recipient = person(action.recipient);

  const done = (target: EvidenceTarget | null, why?: string): ClaimGrounding => {
    for (const r of [entity, actor, recipient]) if (r && r.status === "unresolved") reasons.push(r.reason);
    if (why) reasons.push(why);
    return { claimId: claim.id, entity, actor, recipient, target, reasons };
  };

  if (!action) return done(null, `action "${claim.action}" is not a canonical claim action`);
  if (entity.status !== "resolved") return done(null);
  const qs = questions.filter((q) => q.entityId === entity.id);
  const of = (p: Question["predicate"]) => qs.filter((q) => q.predicate === p);

  const pick = (p: "location" | "heldBy" | "state", value: string): EvidenceTarget | string => {
    const same = of(p).filter((q) => normValue(p, q.value) === normValue(p, value));
    if (same.length === 0) return `no ${p} question for "${value}" on ${entity.id}`;
    if (same.length > 1) return `several ${p} questions for "${value}" on ${entity.id}`;
    const alternativeIds = p === "state" ? [] : of(p).filter((q) => q.id !== same[0]!.id).map((q) => q.id);
    return { questionId: same[0]!.id, alternativeIds };
  };
  /** A role that determines the target must map to this entity's heldBy question. */
  const holder = (r: Resolution | null): { r: Resolution | null; t: EvidenceTarget | null } => {
    if (!r || r.status !== "resolved") return { r, t: null };
    const t = pick("heldBy", r.id);
    if (typeof t === "string") return { r: { status: "unresolved", reason: t }, t: null };
    return { r, t };
  };

  switch (action.kind) {
    case "location":
    case "state": {
      const t = pick(action.kind, action.kind === "location" ? action.zone : action.value);
      return typeof t === "string" ? done(null, t) : done(t);
    }
    case "take": {
      const h = holder(actor);
      actor = h.r;
      return done(h.t);
    }
    case "give": {
      const h = holder(recipient);
      recipient = h.r;
      if (h.t && actor?.status === "resolved" && recipient?.status === "resolved" && actor.id === recipient.id)
        return done(null, "actor and recipient resolve to the same person");
      return done(h.t);
    }
  }
}
