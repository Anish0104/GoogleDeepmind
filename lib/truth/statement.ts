// OWNER: Dev 2. A cheap check, before any model call, that a witness statement is at least an attempt at
// describing something ("The forklift stopped."), not empty, punctuation or keyboard mash ("dfdfd", "asdf").
// Shared by the /new form (inline feedback) and runAccount() (the server never trusts the client).
// Deliberately loose: no vocabulary list and no grammar check. Whether a real statement holds verifiable
// claims is Carbon's job; this only stops calls that cannot produce any.

export const STATEMENT_HELP = "Describe something observable in the recording, such as who moved, what happened, or whether contact occurred.";

export type StatementCheck = { ok: true } | { ok: false; reason: string };

const WORD = /\p{L}[\p{L}\p{M}'’-]*/gu;
const LATIN = /^[a-zà-ÿ'’-]+$/i;
const VOWEL = /[aeiouyà-ÿ]/i;
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{5,}/i;

/** A Latin-script word that cannot be a word: no vowel at all, or five consonants in a row. */
function looksLikeMash(w: string): boolean {
  if (!LATIN.test(w)) return false; // other scripts: no opinion
  return (!VOWEL.test(w) && w.length > 1) || CONSONANT_RUN.test(w);
}

export function checkStatement(input: unknown): StatementCheck {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, reason: "Enter the witness statement." };
  const words = input.trim().match(WORD) ?? [];
  if (words.length === 0) return { ok: false, reason: `The statement has no words. ${STATEMENT_HELP}` };
  const distinct = new Set(words.map((w) => w.toLowerCase()));
  // Scripts written without spaces (e.g. Chinese) come out as one "word": judge those by distinct characters.
  const unspaced = words.length === 1 && !LATIN.test(words[0]!) && new Set(words[0]!).size >= 3;
  if (distinct.size < 2 && !unspaced) return { ok: false, reason: `Write at least a short sentence. ${STATEMENT_HELP}` };
  const mash = words.filter(looksLikeMash).length;
  if (mash * 2 > words.length) return { ok: false, reason: `This doesn't read as a statement. ${STATEMENT_HELP}` };
  return { ok: true };
}
