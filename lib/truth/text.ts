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
