// OWNER: Dev 4. One place that maps a Verdict to its look. Renovate the UI by editing
// this file (and the component className strings) — no data wiring changes needed.
import type { Verdict } from "@/lib/types";

export interface VerdictStyle {
  label: Verdict;
  mark: string; // compact glyph for tight rows
  dot: string; // Tailwind bg for the status dot
  badge: string; // Tailwind classes for the pill
}

export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  Supported: {
    label: "Supported",
    mark: "✓",
    dot: "bg-emerald-500",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  Contradicted: {
    label: "Contradicted",
    mark: "✗",
    dot: "bg-red-500",
    badge: "bg-red-50 text-red-700 ring-1 ring-red-200",
  },
  Insufficient: {
    label: "Insufficient",
    mark: "?",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
};

export function verdictStyle(v: Verdict): VerdictStyle {
  return VERDICT_STYLE[v];
}
