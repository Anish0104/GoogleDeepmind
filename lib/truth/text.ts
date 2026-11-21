// OWNER: Dev 2. Small deterministic text helpers for the truth pipeline: phrase matching,
// stable ids, prompt-data escaping and the wording rules shared by claims.ts and judge.ts.
import { normText } from "@/lib/inference/grid";

export { normText };

const ARTICLES = /^(?:the|a|an|this|that|his|her|their|its)\s+/;

export const stripArticles = (s: string) => normText(s).replace(ARTICLES, "");

const words = (s: string) => normText(s).split(" ").filter(Boolean);

/**
 * Whole-word phrase match in normalised text. With `inflect`, each haystack word may carry a simple
 * suffix ("package" ~ "packages", "open" ~ "opened").
 */
export function mentions(haystack: string, phrase: string, inflect = false): boolean {
  const h = words(haystack);
  const p = words(phrase);
  if (p.length === 0) return false;
  const eq = (w: string, v: string) =>
    w === v || (inflect && v.length >= 3 && ["s", "es", "d", "ed", "ing", "ped", "ted", "ned"].some((x) => w === v + x));
  for (let i = 0; i + p.length <= h.length; i++) if (p.every((v, j) => eq(h[i + j]!, v))) return true;
  return false;
}

/** Only true articles: optional filler between the meaningful words of a short phrase. */
const ARTICLE_WORDS = new Set(["the", "a", "an"]);

/** The phrase's meaningful words: normalised, with the articles "the", "a" and "an" removed. */
export const withoutArticles = (s: string) => words(s).filter((w) => !ARTICLE_WORDS.has(w)).join(" ");

/**
 * Like mentions(), but the haystack may have at most ONE article ("the", "a", "an") between consecutive
 * meaningful words of the phrase ("past entry line" ~ "past the entry line"). Articles in the phrase
 * itself are ignored. Word order and every meaningful word are kept; no other word may come between,
 * and no synonyms are accepted.
 */
export function mentionsAllowingArticles(haystack: string, phrase: string, inflect = false): boolean {
  const h = words(haystack);
  const p = words(withoutArticles(phrase));
  if (p.length === 0) return false;
  const eq = (w: string, v: string) =>
    w === v || (inflect && v.length >= 3 && ["s", "es", "d", "ed", "ing", "ped", "ted", "ned"].some((x) => w === v + x));
  const matchFrom = (i: number, j: number): boolean => {
    if (j === p.length) return true;
    if (i < h.length && eq(h[i]!, p[j]!) && matchFrom(i + 1, j + 1)) return true;
    // one optional article before the next meaningful word (never before the first)
    return j > 0 && i + 1 < h.length && ARTICLE_WORDS.has(h[i]!) && eq(h[i + 1]!, p[j]!) && matchFrom(i + 2, j + 1);
  };
  for (let i = 0; i < h.length; i++) if (eq(h[i]!, p[0]!) && matchFrom(i + 1, 1)) return true;
  return false;
}

const MIN_STEM = 3;
const NO_UNDOUBLE = new Set(["s", "l", "z"]); // "passing" -> "pass", not "pas"

/**
 * One conservative form for an English word: strips ONE of -ing / -ed / -es / -s (only when at least
 * three letters remain), then undoubles a final consonant left by that suffix ("tipped" -> "tip"); a
 * word with no suffix drops a final "e" ("dodge" -> "dodg"). Inflections of one word share a form;
 * different words stay different. Never maps synonyms.
 */
function wordForm(w: string): string {
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (!w.endsWith(suffix) || (suffix === "s" && w.endsWith("ss"))) continue;
    const stem = w.slice(0, -suffix.length);
    if (stem.length < MIN_STEM) continue;
    const a = stem.at(-1)!;
    const undouble = (suffix === "ing" || suffix === "ed") && a === stem.at(-2) && !/[aeiou]/.test(a) && !NO_UNDOUBLE.has(a);
    return undouble ? stem.slice(0, -1) : stem;
  }
  return w.length > MIN_STEM && w.endsWith("e") ? w.slice(0, -1) : w;
}

/**
 * Canonical form of a state phrase for comparing a claim's state with a question's state value:
 * articles removed, each remaining word reduced by wordForm(), word order kept.
 * "the worker dodged" / "dodging" and "moved" / "moving" match; "hit" never matches "touching".
 */
export const stateForm = (s: string) => withoutArticles(s).split(" ").filter(Boolean).map(wordForm).join(" ");

/** cyrb53-style 53-bit hash as 14 hex chars; deterministic, no randomness or clock. */
export function stableHash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Removes any copy of the given data-block tags from untrusted text so it cannot close the block. */
export function escapeBlock(text: string, tag: string): string {
  return text.replace(new RegExp(`<\\s*/?\\s*${tag}\\s*>`, "gi"), "[tag removed]");
}

/** Claims about intent, motive, guilt or deception: never extracted, never stated. */
const MOTIVE = /\b(?:steal|steals|stole|stolen|stealing|theft|thief|rob|robbed|lie|lied|lies|lying|liar|deceive|deceived|deceptive|deliberately|intentionally|purposely|on purpose|in order to|wanted to|tried to|meant to|guilty|criminal|crime|suspicious|suspect|sneaky|sneakily)\b/;
/** Causal links the grid cannot observe. */
const CAUSAL = /\b(?:because|caused|causes|due to|so that|as a result|therefore|led to)\b/;
/** Certainty beyond what probabilities support. */
const CERTAIN = /\b(?:definitely|certainly|clearly|undoubtedly|proves|proven|proof|without doubt|for sure|obviously)\b/;
/** Hedges that mark a statement as uncertain. */
const HEDGE = /\b(?:i think|i believe|maybe|perhaps|probably|possibly|might|may have|not sure|seemed|seems|appears|appeared|likely|uncertain)\b/;

export const infersMotive = (s: string) => MOTIVE.test(normText(s));
export const assertsCause = (s: string) => CAUSAL.test(normText(s));
export const overclaims = (s: string) => CERTAIN.test(normText(s));
export const isHedged = (s: string) => HEDGE.test(normText(s));
export const isQuestion = (s: string) => s.trim().endsWith("?");

/** Word-level negation ("never", "not", "didn't", "nobody", "without", ...). Matches whole words only. */
const NEGATION = /\b(?:never|not|no|nobody|none|nothing|without|neither|nor|cannot)\b|n['’]t\b/i;
export const isNegated = (s: string) => NEGATION.test(s);

/** A temporal order between events ("stopped before reaching the worker", "until", "by the time"). */
const ORDERING = /\b(?:before|until|till|by the time|prior to|earlier than|later than)\b/i;
export const isTemporallyOrdered = (s: string) => ORDERING.test(s);

/**
 * Persistence: the state is asserted to have held continuously ("stayed clear", "remained stopped
 * throughout", "the whole time", "always", "all along"). Whole words only.
 */
const PERSISTENCE =
  /\b(?:stay|stays|stayed|staying|remain|remains|remained|remaining|keep|keeps|kept|keeping|throughout|always|all along|continuously|constantly|the whole (?:time|way|while)|the entire (?:time|way|while)|all the time|at all times)\b/i;
export const isPersistent = (s: string) => PERSISTENCE.test(s);
