// OWNER: Dev 3 (contract keeper). The contract between all four devs.
// Changes need a quick OK from the group. Copied from the Implementation Plan, section 5.
import type { QUESTION_SETS } from "@/lib/perception/questionSets";

// ---------- capture ----------
export type CameraId = "A" | "B" | "C" | "D";

export interface SceneManifest {
  sceneId: string;
  split: "starter" | "dev" | "heldout" | "demo";
  room: string;
  cameras: CameraId[];
  excludedCameras: CameraId[];
  files: Partial<Record<CameraId, string>>; // data/scenes/<id>/cam-A.webm
  durationS: number;
  createdAt: string;
  plannedOcclusion: boolean; // from scriptgen, never shown to agents
  presynced?: boolean; // footage already synchronised (e.g. Assembly101): perceive skips sync, zero offsets
  questionSet?: keyof typeof QUESTION_SETS; // a fixed question set (e.g. "warehouse") instead of scout's questions
  roi?: boolean; // crop slices to where things move in each camera
}

export interface SyncResult {
  camera: CameraId;
  offsetS: number;
  driftPerMin: number;
  method: "clap" | "flash" | "both";
}

// ---------- perception ----------
export type Zone = "A" | "B" | "C" | "D" | "E" | "F";

export interface Entity {
  id: string;
  description: string;
  color?: string;
  feature?: string;
}

export interface Question {
  id: string;
  entityId: string;
  predicate: "location" | "heldBy" | "state" | "visible";
  value: string;
  text: string;
}

export interface GridRow {
  sceneId: string;
  camera: CameraId;
  t: number; // slice start (s)
  questionId: string;
  pYes: number;
  pVisible: number;
}

export interface ViewDescription {
  camera: CameraId;
  text: string; // "side-on to zone C, unobstructed"
}

// ---------- inference ----------
export interface Event {
  entityId: string;
  from: string;
  to: string;
  t: number;
  confidence: number;
  cameras: CameraId[];
}

export interface Evidence {
  camera: CameraId;
  window: [number, number];
  visible: number;
  supports: number | null;
  contradicts: number | null;
  clipId: string;
  source: "initial" | "investigator" | "skeptic";
}

export type Verdict = "Supported" | "Contradicted" | "Insufficient";

// ---------- truth ----------
export interface Claim {
  id: string;
  sceneId: string;
  text: string;
  actor: string;
  object: string;
  action: string;
  window: [number, number];
  timeIsPrecise: boolean;
}

export interface Audit {
  supportScore: number | null;
  contradictScore: number | null;
  clipId: string;
}

export interface LabelChange {
  from: Verdict;
  to: Verdict;
  by: "initial" | "investigator" | "skeptic";
  blocked?: boolean; // true if enforceDowngradeOnly() kept the old label
  reason: string;
  at: string;
}

export interface ClaimResult {
  claimId: string;
  verdict: Verdict;
  evidence: Evidence[];
  audit: Audit | null;
  history: LabelChange[];
}

// ---------- agents ----------
export type AgentName = "investigator" | "skeptic";

/** Which turn function actually ran: the Gemini Managed Agent, the stand-in, or the stand-in after a managed failure. */
export type AgentMode = "managed" | "standin" | "standin-fallback";

export interface AgentMenu {
  agent: AgentName;
  claim: Claim;
  currentVerdict: Verdict;
  evidence: Evidence[];
  views: ViewDescription[];
  stillIds: Partial<Record<CameraId, string>>;
  includedCameras: CameraId[];
  allowedRangeS: [number, number];
  alreadyChecked: { camera: CameraId; window: [number, number] }[];
  followUpsLeft: number; // starts at 2
}

export interface InspectWindowArgs {
  camera_id: CameraId;
  start_s: number;
  end_s: number;
  crop: "full" | "entity";
  reason: string;
}

export interface StopArgs {
  reason: string;
}

export interface AgentStep {
  agent: AgentName;
  claimId: string;
  n: number;
  action: "inspect_window" | "stop" | "rejected";
  args: InspectWindowArgs | StopArgs;
  rejectionReason?: string;
  droppedFields?: string[]; // unknown fields the bridge stripped from the agent's tool call
  implicitStop?: boolean; // the agent finished without calling stop; the loop recorded a stop for it
  mode?: AgentMode; // which turn function ran this step
  checkedWindow?: [number, number]; // the part of the requested clip actually checked (clamped to the claim window)
  result?: Evidence;
  tokens: number;
  costUsd: number;
  latencyMs: number;
}

// ---------- pipeline ----------
/** data/scenes/<id>/run.json: progress of the scene pipeline, read by the board's event stream. */
export interface RunStatus {
  status: "queued" | "running" | "done" | "failed";
  /** Current stage, or the stage that failed: claims, probe, sync, slice, scout, lattice, evidence, audit, stills, agents, done. */
  stage: string;
  startedAt: string;
  finishedAt?: string;
  /** Why it failed: the error message, or "budget" for a budget stop. */
  error?: string;
}

// ---------- evaluation ----------
export interface GroundTruthItem {
  sceneId: string;
  claimId?: string;
  eventId?: string;
  label: Verdict | "Ambiguous";
  labelerA: string;
  labelerB: string;
  note?: string;
}

export interface CostRecord {
  at: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  cachedTokens?: number; // part of inputTokens served from cache (tracked separately)
  sceneId?: string;
}
