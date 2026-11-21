// OWNER: Dev 2 owns THRESHOLDS (set on the dev set, frozen before the held-out run).
// Dev 1 owns MODELS. Dev 3 owns LIMITS and paths.

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};

export const THRESHOLDS = {
  /** A camera counts as a usable view at or above this visibility. */
  USABLE: 0.6,
  /** Support score needed for Supported. */
  CLEAR: 0.8,
  /** Contradict score needed for Contradicted. */
  DECISIVE: 0.9,
  /** A Supported label within this margin of a threshold counts as weak (Skeptic runs). */
  WEAK_SUPPORT_MARGIN: 0.05,
  /** Zone tracking: a camera votes for a zone only if every other zone's pYes is below this. */
  OTHER_ZONE_MAX: 0.5,
} as const;

export const MODELS = {
  SCOUT: process.env.MODEL_SCOUT ?? "gemini-4-hydrogen",
  JUDGE: process.env.MODEL_JUDGE ?? "gemini-4-carbon",
  DECIDE: process.env.MODEL_DECIDE ?? "gemini-decision-1",
  BASELINE: process.env.MODEL_BASELINE ?? "gemini-4-neon",
  AGENT_ID: process.env.AGENT_ID ?? "antigravity-preview-05-2026",
  AGENT_MODEL: process.env.AGENT_MODEL || undefined,
} as const;

export const LIMITS = {
  SLICE_S: 0.5,
  MOTION_SLICE_S: 0.25,
  CLIP_MIN_S: 1,
  CLIP_MAX_S: 4,
  AGENT_MAX_CHECKS: 2,
  AGENT_MAX_TOTAL_TOKENS: num(process.env.AGENT_MAX_TOTAL_TOKENS, 60_000),
  BUDGET_HARD_STOP_USD: num(process.env.BUDGET_HARD_STOP_USD, 8),
  MAX_CONCURRENT_CALLS: num(process.env.MAX_CONCURRENT_CALLS, 2),
  CARBON_TIMEOUT_MS: 6_000,
} as const;

export const ZONES = ["A", "B", "C", "D", "E", "F"] as const;

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const COST_LOG = "./logs/costs.jsonl";
export const IS_FREE_TIER = (process.env.GEMINI_TIER ?? "free") !== "paid";
