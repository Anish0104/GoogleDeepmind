// OWNER: Dev 3. Scores the warehouse eval: extracted claims are matched to the account's statements by text
// similarity, then each statement is judged on the label after agents (and, for comparison, before agents).
//   critical       Supported on a false statement, or Contradicted on a true one (target 0)
//   correct        the label equals the statement's expected label
//   coverage-loss  expected decidable (Supported/Contradicted) but labelled Insufficient
//   overreach      expected Insufficient (worker not visible) but labelled, and not critical
//   miss           no extracted claim matched the statement (an extraction miss)
// Rates carry 95% Wilson intervals from Dev 4's eval/stats.ts.
import type { Verdict } from "@/lib/types";
import { wilson, type Rate } from "@/eval/stats";
import type { EvalAccount, Statement } from "@/scripts/eval/accounts";

export interface ClaimLabel {
  claimId: string;
  text: string;
  /** Label from the account (before agents). */
  before: Verdict;
  /** Label after the agents ran. */
  after: Verdict;
}

export type Outcome = "critical" | "correct" | "coverage-loss" | "overreach" | "miss";

export interface ScoredStatement {
  sceneId: string;
  account: string;
  kind: Statement["kind"];
  text: string;
  truth: boolean;
  expected: Verdict;
  claimId: string | null;
  claimText: string | null;
  similarity: number | null;
  before: Verdict | null;
  after: Verdict | null;
  outcomeBefore: Outcome;
  outcome: Outcome;
}

// ---------- matching ----------

const STOP = new Set(["the", "a", "an", "it", "me", "i", "my", "to", "of", "at", "in", "on", "was", "is", "and", "that", "this", "them", "they", "he", "she", "him", "her", "speaker", "worker", "person", "uncertain"]);
const NEGATION = new Set(["not", "never", "no"]);

function tokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/\(uncertain\)/g, " ")
    .replace(/n't\b/g, " not")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 ? w.replace(/(ing|ed|s)$/, "") : w))
    .filter((w) => !STOP.has(w));
  return new Set(words);
}

/** Word-overlap (Jaccard) similarity, halved when exactly one side is negated. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const neg = (t: Set<string>) => [...t].some((w) => NEGATION.has(w));
  return neg(ta) === neg(tb) ? jaccard : jaccard / 2;
}

export const MATCH_THRESHOLD = 0.3;

/** Statement index -> its claim. Greedy on the best-scoring pairs; each claim and statement used once. */
export function matchClaims(statements: Statement[], claims: ClaimLabel[]): Map<number, { claim: ClaimLabel; score: number }> {
  const pairs: { s: number; c: number; score: number }[] = [];
  statements.forEach((st, s) => claims.forEach((cl, c) => pairs.push({ s, c, score: similarity(st.text, cl.text) })));
  pairs.sort((x, y) => y.score - x.score || x.s - y.s || x.c - y.c);
  const out = new Map<number, { claim: ClaimLabel; score: number }>();
  const usedClaims = new Set<number>();
  for (const p of pairs) {
    if (p.score < MATCH_THRESHOLD) break;
    if (out.has(p.s) || usedClaims.has(p.c)) continue;
    out.set(p.s, { claim: claims[p.c]!, score: p.score });
    usedClaims.add(p.c);
  }
  return out;
}

// ---------- scoring ----------

export function classify(label: Verdict, truth: boolean, expected: Verdict): Exclude<Outcome, "miss"> {
  if ((label === "Supported" && !truth) || (label === "Contradicted" && truth)) return "critical";
  if (label === expected) return "correct";
  if (expected !== "Insufficient" && label === "Insufficient") return "coverage-loss";
  return "overreach";
}

export interface ScoredAccount {
  rows: ScoredStatement[];
  /** Extracted claims that matched no statement. */
  extraClaims: ClaimLabel[];
  /** Set when the account could not be run (e.g. a budget stop); the account is then not scored. */
  error?: string;
}

export function scoreAccount(sceneId: string, account: EvalAccount, claims: ClaimLabel[]): ScoredAccount {
  const matched = matchClaims(account.statements, claims);
  const rows = account.statements.map((st, i): ScoredStatement => {
    const m = matched.get(i);
    const base = { sceneId, account: account.name, kind: st.kind, text: st.text, truth: st.truth, expected: st.expected };
    if (!m) return { ...base, claimId: null, claimText: null, similarity: null, before: null, after: null, outcomeBefore: "miss", outcome: "miss" };
    return {
      ...base,
      claimId: m.claim.claimId,
      claimText: m.claim.text,
      similarity: Number(m.score.toFixed(3)),
      before: m.claim.before,
      after: m.claim.after,
      outcomeBefore: classify(m.claim.before, st.truth, st.expected),
      outcome: classify(m.claim.after, st.truth, st.expected),
    };
  });
  const used = new Set(rows.map((r) => r.claimId));
  return { rows, extraClaims: claims.filter((c) => !used.has(c.claimId)) };
}

export interface Summary {
  statements: number;
  matched: number;
  misses: number;
  /** Over matched statements, after agents. */
  critical: Rate;
  criticalBefore: number;
  correct: Rate;
  coverageLoss: number;
  overreach: number;
  expectedInsufficient: { total: number; handled: number };
  agents: { changed: number; fixed: number; broke: number; criticalRemoved: number; criticalAdded: number };
}

export function summarize(rows: ScoredStatement[]): Summary {
  const matched = rows.filter((r) => r.outcome !== "miss");
  const count = (o: Outcome, key: "outcome" | "outcomeBefore" = "outcome") => matched.filter((r) => r[key] === o).length;
  const expIns = matched.filter((r) => r.expected === "Insufficient");
  return {
    statements: rows.length,
    matched: matched.length,
    misses: rows.length - matched.length,
    critical: wilson(count("critical"), matched.length),
    criticalBefore: count("critical", "outcomeBefore"),
    correct: wilson(count("correct"), matched.length),
    coverageLoss: count("coverage-loss"),
    overreach: count("overreach"),
    expectedInsufficient: { total: expIns.length, handled: expIns.filter((r) => r.after === "Insufficient").length },
    agents: {
      changed: matched.filter((r) => r.before !== r.after).length,
      fixed: matched.filter((r) => r.outcomeBefore !== "correct" && r.outcome === "correct").length,
      broke: matched.filter((r) => r.outcomeBefore === "correct" && r.outcome !== "correct").length,
      criticalRemoved: matched.filter((r) => r.outcomeBefore === "critical" && r.outcome !== "critical").length,
      criticalAdded: matched.filter((r) => r.outcomeBefore !== "critical" && r.outcome === "critical").length,
    },
  };
}

// ---------- report ----------

export interface WarehouseReport {
  generatedAt: string;
  agentMode: string;
  scenes: { sceneId: string; accounts: (ScoredAccount & { name: string })[] }[];
}

const pct = (r: Rate) => (r.total ? `${(r.rate * 100).toFixed(0)}% [${(r.low * 100).toFixed(0)}–${(r.high * 100).toFixed(0)}%]` : "n/a");

function summaryTable(rows: { label: string; s: Summary }[]): string[] {
  return [
    "| | Statements | Matched | Extraction misses | Critical errors (target 0) | Correct | Coverage loss | Overreach | Expected-Insufficient handled | Changed by agents (fixed / broke) |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(
      ({ label, s }) =>
        `| ${label} | ${s.statements} | ${s.matched} | ${s.misses} | ${s.critical.count} of ${s.critical.total} (before agents: ${s.criticalBefore}) | ${s.correct.count} of ${s.correct.total} · ${pct(s.correct)} | ${s.coverageLoss} | ${s.overreach} | ${s.expectedInsufficient.handled} of ${s.expectedInsufficient.total} | ${s.agents.changed} (${s.agents.fixed} / ${s.agents.broke}) |`,
    ),
  ];
}

/** How the eval works; printed with every report so the numbers always come with their method. */
export const METHOD = [
  "## Method",
  "",
  "- **Scenes:** NVIDIA PhysicalAI SDG-Warehouse `forklift_human_nearmiss` runs, imported as presynced scenes and",
  "  perceived once. The answer key is `data/labels/<sceneId>.truth.json`; only `scripts/eval/` reads it.",
  "- **Accounts:** per scene, `scripts/eval/gen-accounts.ts` writes a \"true\" account (every statement true) and a",
  "  \"mixed\" account (2 statements flipped to false), deterministic per scene. Statements: contact, dodge, stop,",
  "  moving, time. A statement whose field is missing from the answer key is left out.",
  "- **Expected label:** Insufficient if no included camera sees the worker in the slices around the moment;",
  "  otherwise Supported for a true statement and Contradicted for a false one.",
  "- **Run:** each account runs on its own clone of the scene (`<sceneId>__<account>`): Dev 2's `runAccount()`",
  "  (claims → grounding → evidence → citation → audit → verdict), then our agents (`POST .../agents`).",
  "- **Scoring:** extracted claims are matched to statements by word overlap (negation-aware); a statement with no",
  "  match is an extraction miss. **Critical error** = Supported on a false statement or Contradicted on a true one",
  "  (target 0). **Coverage loss** = Insufficient where a decision was possible. **Overreach** = a label where the",
  "  worker wasn't visible. Rates carry 95% Wilson intervals.",
  "",
].join("\n");

/** The docs/proof/warehouse-eval.md body. Only measured numbers; failed accounts are listed, not scored. */
export function formatMarkdown(r: WarehouseReport): string {
  const all = r.scenes.flatMap((s) => s.accounts.flatMap((a) => a.rows));
  const overall = summarize(all);
  const lines = [
    "# Warehouse eval",
    "",
    `Generated ${r.generatedAt} by \`scripts/eval/run-warehouse.ts\`. Agent mode: ${r.agentMode}.`,
    "",
    `Critical errors (target 0) | ${overall.critical.count} of ${overall.critical.total} matched statements, 95% interval ${pct(overall.critical)}`,
    "",
    "## Summary",
    "",
    ...summaryTable([
      { label: "**All scenes**", s: overall },
      ...r.scenes.map((s) => ({ label: s.sceneId, s: summarize(s.accounts.flatMap((a) => a.rows)) })),
    ]),
    "",
  ];
  const failed = r.scenes.flatMap((s) => s.accounts.filter((a) => a.error).map((a) => `- ${s.sceneId} / ${a.name}: not scored: ${a.error}`));
  if (failed.length) lines.push("## Accounts not scored", "", ...failed, "");
  lines.push(
    "## Every statement: before → after agents",
    "",
    "| Scene | Account | Statement | True? | Expected | Label (before → after) | Outcome |",
    "|---|---|---|---|---|---|---|",
    ...all.map(
      (x) =>
        `| ${x.sceneId} | ${x.account} | ${x.kind} | ${x.truth} | ${x.expected} | ${x.before === null ? "not extracted" : `${x.before} → ${x.after}`} | ${x.outcome} |`,
    ),
    "",
    METHOD,
  );
  return lines.join("\n");
}
