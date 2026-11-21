// OWNER: Dev 4. One place that maps a Verdict (and an agent) to its look. These are the
// design tokens from the frontend handoff; components read colors from here only.
import type { AgentName, Verdict } from "@/lib/types";

export interface VerdictStyle {
  label: Verdict;
  mark: string; // compact glyph for tight rows
  color: string; // ink and stamp border
  bg: string; // soft fill for decided cards
  border: string; // soft border for decided cards
  glow: string; // stamp and dot glow
  long: string; // one-line description for the Proof stamp
}

export const VERDICT_STYLE: Record<Verdict, VerdictStyle> = {
  Supported: {
    label: "Supported",
    mark: "✓",
    color: "#5BE49B",
    bg: "rgba(91,228,155,0.07)",
    border: "rgba(91,228,155,0.32)",
    glow: "rgba(91,228,155,0.25)",
    long: "Usable cameras agree and the support score clears 0.80.",
  },
  Contradicted: {
    label: "Contradicted",
    mark: "✗",
    color: "#FF5A47",
    bg: "rgba(255,90,71,0.07)",
    border: "rgba(255,90,71,0.35)",
    glow: "rgba(255,90,71,0.25)",
    long: "Visible evidence contradicts the claim at 0.90 or above. The hardest label to get.",
  },
  Insufficient: {
    label: "Insufficient",
    mark: "?",
    color: "#FFC23D",
    bg: "rgba(255,194,61,0.06)",
    border: "rgba(255,194,61,0.3)",
    glow: "rgba(255,194,61,0.22)",
    long: "The footage cannot settle this claim either way.",
  },
};

export function verdictStyle(v: Verdict): VerdictStyle {
  return VERDICT_STYLE[v];
}

/** Who acted: the agents, plus "initial" for the first verdict() pass. */
export const AGENT_COLOR: Record<AgentName | "initial", string> = {
  investigator: "#7CC7FF",
  skeptic: "#B79CFF",
  initial: "#ECE6DA",
};

/** Evidence source tint on the Proof screen. */
export const SOURCE_COLOR: Record<AgentName | "initial", string> = {
  initial: "#9AA0A8",
  investigator: "#7CC7FF",
  skeptic: "#B79CFF",
};

export function agentColor(by: AgentName | "initial"): string {
  return AGENT_COLOR[by];
}
