// OWNER: Dev 4. Pure helpers for the Capture screen animations.
import type { Claim } from "@/lib/types";
import { winTxt } from "@/components/canvas/math";

/** Characters the split animation types in total: each claim plus a short pause. */
export function splitTotal(claims: Claim[]): number {
  return claims.reduce((a, c) => a + c.text.length + 6, 0);
}

/** The claims typed so far after `chars` characters, in order. */
export function splitClaims(claims: Claim[], chars: number): { id: string; text: string; win: string }[] {
  let acc = 0;
  const out: { id: string; text: string; win: string }[] = [];
  for (const c of claims) {
    const n = Math.max(0, Math.min(c.text.length, Math.floor(chars - acc)));
    acc += c.text.length + 6;
    if (n > 0) out.push({ id: c.id, text: c.text.slice(0, n), win: winTxt(c.window) + (c.timeIsPrecise ? "" : " · approx") });
  }
  return out;
}

/** The six pipeline stages and the model or tool behind each. */
export const STAGES: [string, string][] = [
  ["Sync 4 cameras", "clap + flash"],
  ["Scout objects and questions", "gemini-4-hydrogen"],
  ["Every question × camera × 0.5 s", "gemini-decision-1"],
  ["verdict() rules → labels", "TypeScript"],
  ["Claims and cited timeline", "gemini-4-carbon"],
  ["Investigator + Skeptic", "managed agents"],
];

/** Progress 0..1 of stage i when the run counter is at `run` (0..6). */
export function stageProgress(run: number, i: number): number {
  return Math.max(0, Math.min(1, run - i));
}

/** Offset text for a camera tile at sync progress 0..1. */
export function offsetText(offset: number, sync: number): string {
  if (sync < 0.05) return "—";
  const v = offset * (sync >= 1 ? 1 : sync);
  return `${v >= 0 ? "+" : ""}${v.toFixed(3)}s`;
}

/** The spoken account as one paragraph, rebuilt from the claims. */
export function accountText(claims: Claim[]): string {
  return claims.map((c) => c.text).join(" ");
}

