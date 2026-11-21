// OWNER: Dev 4. Client calls for the New Investigation flow, over the existing scene routes:
// scene/start -> upload per camera -> scene/[id]/run (waits on run.json via the event stream)
// -> scene/[id]/account -> scene/[id]/agents. Every call takes an injectable fetch for tests.
import type { CameraId, ClaimResult, RunStatus, Verdict } from "@/lib/types";
import { proofHref } from "@/components/Board";

/** Dev 1's whole-file upload: one video per camera (multipart: sceneId, camera, file), max 500 MB. */
export const UPLOAD_URL = "/api/ingest/file";

export const ALL_CAMERAS: CameraId[] = ["A", "B", "C", "D"];

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (url, init) => fetch(url, init);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(f: Fetch, url: string, init: RequestInit): Promise<T> {
  const res = await f(url, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const scenePath = (sceneId: string, tail: string) => `/api/scene/${encodeURIComponent(sceneId)}/${tail}`;

export interface InvestigationForm {
  room: string;
  cameras: CameraId[];
  excluded: CameraId[];
  /** "" lets scout write the questions; otherwise a key of QUESTION_SETS. */
  questionSet: string;
}

/** The body for POST /api/scene/start. */
export function startBody(form: InvestigationForm) {
  const cameras = ALL_CAMERAS.filter((c) => form.cameras.includes(c));
  return {
    split: "demo" as const,
    room: form.room.trim(),
    cameras,
    excludedCameras: cameras.filter((c) => form.excluded.includes(c)),
    ...(form.questionSet ? { questionSet: form.questionSet } : {}),
  };
}

export async function createInvestigation(form: InvestigationForm, f: Fetch = defaultFetch): Promise<string> {
  const out = await call<{ sceneId: string }>(f, "/api/scene/start", postJson(startBody(form)));
  return out.sceneId;
}

export async function uploadRecording(sceneId: string, camera: CameraId, file: File, f: Fetch = defaultFetch): Promise<void> {
  const body = new FormData();
  body.set("sceneId", sceneId);
  body.set("camera", camera);
  body.set("file", file, file.name);
  await call(f, UPLOAD_URL, { method: "POST", body });
}

/** Starts perception. The 202 only means queued: wait on waitForPerceived() for the result. */
export async function startRun(sceneId: string, f: Fetch = defaultFetch): Promise<void> {
  await call(f, scenePath(sceneId, "run"), { method: "POST" });
}

export async function submitAccount(sceneId: string, transcript: string, f: Fetch = defaultFetch): Promise<ClaimResult[]> {
  if (!transcript.trim()) throw new Error("Add the witness statement first.");
  return call<ClaimResult[]>(f, scenePath(sceneId, "account"), postJson({ transcript }));
}

export interface AgentOutcome {
  claimId: string;
  ran: boolean;
  agent?: string;
  reason?: string;
  before?: Verdict | null;
  after?: Verdict | null;
}

export async function runAgents(sceneId: string, f: Fetch = defaultFetch): Promise<AgentOutcome[]> {
  const out = await call<{ claims: AgentOutcome[] }>(f, scenePath(sceneId, "agents"), { method: "POST" });
  return out.claims;
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  probe: "Checking the recordings",
  perceive: "Reading the footage",
  stills: "Saving stills",
  perceived: "Footage read",
};

/** A readable line for run.json. */
export function runPhase(run: RunStatus | null): { label: string; done: boolean; failed: boolean } {
  if (!run) return { label: "Waiting for the run to start", done: false, failed: false };
  if (run.status === "failed") {
    return { label: `Failed at ${STAGE_LABEL[run.stage] ?? run.stage}: ${run.error ?? "unknown error"}`, done: false, failed: true };
  }
  const done = run.status === "perceived" || run.status === "done";
  return { label: done ? "Footage read" : (STAGE_LABEL[run.stage] ?? run.stage), done, failed: false };
}

export interface EventSourceLike {
  addEventListener(type: string, fn: (e: MessageEvent) => void): void;
  close(): void;
  onerror: ((e: Event) => void) | null;
}

/**
 * Resolves when the scene's saved run.json reaches "perceived" (or "done"), read from the
 * scene event stream, so the flow never trusts the run route's 202 as completion.
 */
export function waitForPerceived(
  sceneId: string,
  opts: { open?: (url: string) => EventSourceLike; onRun?: (run: RunStatus) => void } = {},
): Promise<RunStatus> {
  const open = opts.open ?? ((url: string) => new EventSource(url));
  return new Promise((resolve, reject) => {
    const src = open(scenePath(sceneId, "events"));
    src.addEventListener("run", (e) => {
      let run: RunStatus;
      try {
        run = JSON.parse(e.data as string) as RunStatus;
      } catch {
        return;
      }
      opts.onRun?.(run);
      const phase = runPhase(run);
      if (phase.done) {
        src.close();
        resolve(run);
      } else if (phase.failed) {
        src.close();
        reject(new Error(run.error ?? "The run failed."));
      }
    });
    // EventSource reconnects on its own after a dropped connection; nothing to do here.
    src.onerror = null;
  });
}

const sceneDir = (sceneId: string) => `data/scenes/${sceneId}`;

export const sceneBoardHref = (sceneId: string) => `/board?scene=${encodeURIComponent(sceneDir(sceneId))}`;
export const sceneProofHref = (sceneId: string, claimId: string) => proofHref(claimId, sceneDir(sceneId));

export const phoneLink = (origin: string, sceneId: string, camera: CameraId) =>
  `${origin}/phone?scene=${encodeURIComponent(sceneId)}&cam=${camera}`;
