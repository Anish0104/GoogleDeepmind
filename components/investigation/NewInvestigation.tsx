// OWNER: Dev 2 (New Investigation UI). A real, local investigation: create the scene, upload one prerecorded
// recording per camera (Dev 1's POST /api/ingest/file), choose the incident window, run perception (waiting for run.json "perceived" on the scene's event stream), check the
// witness statement (POST .../account), run the agents (POST .../agents), then show the final SAVED results.
// Every step is a real backend call; a step is shown done only after the backend confirms it. Retrying resumes
// from the first unfinished step with the same scene; billable steps are never retried automatically.
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AgentStep, CameraId, ClaimResult, RunStatus } from "@/lib/types";
import { checkStatement } from "@/lib/truth/statement";

const ALL_CAMS: CameraId[] = ["A", "B", "C", "D"];
const MAX_MB = 500; // MAX_RECORDING_BYTES in lib/capture/ingest.ts (Dev 1's /api/ingest/file)
const EXTS = ["mp4", "webm", "mov"];
/** Dev 1's estimate: about 16 model calls per second of analysed footage (4 cameras). An approximation only. */
const CALLS_PER_SECOND = 16;
const EXPENSIVE_CALLS = 480; // warn above ~30 s of footage
/**
 * Whether the backend applies an incident window. Today it does not: POST /api/scene/start has no
 * analysisWindow field, POST .../run takes no body, and the runner never passes { window } to perceiveScene()
 * (Dev 1's window support is on navneet/evidence-engine 2a5c304, not main). Until that contract exists, a run
 * is allowed only when the selected window is the whole recording, which is what the backend analyses.
 */
const BACKEND_APPLIES_WINDOW = false;

const QUESTION_SETS = [
  { value: "sdg-nearmiss", label: "Factory forklift near miss", help: "Fixed questions about a forklift, a worker, proximity, contact and dodging." },
  { value: "warehouse", label: "Warehouse crossing", help: "Fixed questions for the warehouse crossing scenario." },
  { value: "", label: "General investigation", help: "No fixed questions: the system discovers what to ask from the footage." },
] as const;

const C = { text: "#FAF8F5", muted: "#94A3B8", dim: "#64748B", faint: "#334155", coral: "#F43F5E", blue: "#38BDF8", green: "#34D399", amber: "#FBBF24" };
const CARD = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, background: "rgba(15,17,23,0.65)", backdropFilter: "blur(20px)", padding: 26, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" } as const;
const LABEL = { fontSize: 11, letterSpacing: "0.14em", color: C.dim, textTransform: "uppercase" } as const;
const INPUT = { width: "100%", boxSizing: "border-box", background: "#0A0B0D", color: C.text, border: "1px solid rgba(236,230,218,0.14)", borderRadius: 12, padding: "12px 14px", fontSize: 15, fontFamily: "inherit", outline: "none" } as const;

type StepKey = "create" | "upload" | "perceive" | "account" | "agents" | "done";
type StepState = "pending" | "active" | "done" | "failed";
const STEPS: { key: StepKey; label: string; help: string }[] = [
  { key: "create", label: "Creating investigation", help: "Registering the investigation and its cameras." },
  { key: "upload", label: "Uploading camera recordings", help: "Saving camera recordings locally." },
  { key: "perceive", label: "Processing visual evidence", help: "Examining visual evidence from the selected cameras." },
  { key: "account", label: "Analyzing witness statement", help: "Breaking the witness statement into verifiable claims." },
  { key: "agents", label: "Investigating uncertain claims", help: "Checking additional evidence where needed." },
  { key: "done", label: "Results ready", help: "Your investigation is ready to inspect." },
];
const STAGE_TEXT: Record<string, string> = { queued: "Queued", probe: "Probing recordings", perceive: "Perceiving (sync, slicing, scouting, scoring)", stills: "Preparing stills", perceived: "Perception complete" };

interface Upload {
  file: File | null;
  status: "empty" | "ready" | "uploading" | "uploaded" | "failed";
  progress: number;
  error?: string;
  durationS?: number;
  hasAudio?: boolean;
  warning?: string;
  /** A recording already saved on the server (resumed investigation). */
  savedName?: string;
}
interface Summary {
  claims: number;
  counts: Record<"Supported" | "Contradicted" | "Insufficient", number>;
}

class StepError extends Error {
  constructor(public step: StepKey, message: string) {
    super(message);
  }
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const msg = typeof body?.error === "string" && body.error ? body.error : fallback;
  return `${msg} (HTTP ${res.status})`;
}

interface Saved {
  durationS: number;
  hasAudio: boolean;
  warning?: string;
}

/** Whole-file multipart upload to Dev 1's POST /api/ingest/file, with real byte progress. */
function uploadFile(sceneId: string, camera: CameraId, file: File, onProgress: (p: number) => void): Promise<Saved> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/ingest/file");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onload = () => {
      let body: { ok?: boolean; error?: string; durationS?: number; hasAudio?: boolean; warning?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 200 && body?.ok && typeof body.durationS === "number")
        resolve({ durationS: body.durationS, hasAudio: body.hasAudio === true, ...(body.warning ? { warning: body.warning } : {}) });
      else reject(new Error(`${body?.error ?? "Upload failed."} (HTTP ${xhr.status})`));
    };
    const form = new FormData();
    form.append("sceneId", sceneId);
    form.append("camera", camera);
    form.append("file", file);
    xhr.send(form);
  });
}

function checkFile(f: File): string | null {
  const ext = f.name.toLowerCase().split(".").pop();
  if (!ext || !EXTS.includes(ext)) return "Only .mp4, .webm and .mov recordings are supported.";
  if (f.size === 0) return "The file is empty.";
  if (f.size > MAX_MB * 1024 * 1024) return `File is larger than the ${MAX_MB} MB limit.`;
  return null;
}

const round1 = (n: number) => Math.floor(n * 10) / 10;

type WindowCheck = { ok: true; start: number; end: number } | { ok: false; error: string | null };
/** The incident window [start, end) in seconds on the recordings' timeline, bounded by the shortest recording. */
export function checkWindow(startText: string, endText: string, maxS: number | null): WindowCheck {
  if (maxS === null) return { ok: false, error: null };
  if (startText.trim() === "" || endText.trim() === "") return { ok: false, error: "Enter a start and an end time." };
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "Start and end must be numbers of seconds." };
  if (start < 0) return { ok: false, error: "Start cannot be negative." };
  if (end <= start) return { ok: false, error: "End must be after start." };
  if (end > maxS + 1e-6) return { ok: false, error: `End cannot be after ${maxS.toFixed(1)} s, the shortest recording.` };
  return { ok: true, start, end };
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const sceneDir = (id: string) => encodeURIComponent(`data/scenes/${id}`);
const emptyUploads = (): Record<CameraId, Upload> => ({ A: { file: null, status: "empty", progress: 0 }, B: { file: null, status: "empty", progress: 0 }, C: { file: null, status: "empty", progress: 0 }, D: { file: null, status: "empty", progress: 0 } });
const freshSteps = (): Record<StepKey, StepState> => ({ create: "pending", upload: "pending", perceive: "pending", account: "pending", agents: "pending", done: "pending" });

export function NewInvestigation() {
  const [name, setName] = useState("Factory forklift near miss");
  const [cams, setCams] = useState<CameraId[]>([...ALL_CAMS]);
  const [qset, setQset] = useState<string>("sdg-nearmiss");
  const [presynced, setPresynced] = useState(true);
  const [statement, setStatement] = useState("");
  const [uploads, setUploads] = useState<Record<CameraId, Upload>>(emptyUploads);
  const [winStart, setWinStart] = useState("0");
  const [winEnd, setWinEnd] = useState("");

  const [sceneId, setSceneId] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(freshSteps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [claimCount, setClaimCount] = useState<number | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [agentsRan, setAgentsRan] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  // Progress the controller reads synchronously (state would be stale inside one async run).
  const prog = useRef({ runStarted: false, perceptionFailed: false });
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  // /new?scene=<id>: resume an existing investigation from its SAVED state (no request that costs anything).
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("scene");
    if (!id) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/scene/${encodeURIComponent(id)}/results`, { cache: "no-store" });
      if (!res.ok) throw new Error(await errorOf(res, `Could not load investigation ${id}.`));
      const b = (await res.json()) as {
        manifest: { room: string; cameras: CameraId[]; durationS: number; recorded: string[]; presynced: boolean; questionSet: string | null };
        run: RunStatus | null;
        claims: unknown[];
        agentsRan?: boolean;
      };
      if (cancelled) return;
      const m = b.manifest;
      setSceneId(id);
      setName(m.room);
      setCams(ALL_CAMS.filter((c) => m.cameras.includes(c)));
      setQset(m.questionSet ?? "");
      setPresynced(m.presynced);
      const ups = emptyUploads();
      for (const c of m.cameras)
        if (m.recorded.includes(c) && m.durationS > 0) ups[c] = { file: null, status: "uploaded", progress: 100, durationS: m.durationS, savedName: `cam-${c} (saved)` };
      setUploads(ups);
      const allUp = m.cameras.every((c) => ups[c].status === "uploaded");
      const st = b.run?.status;
      prog.current.runStarted = st === "queued" || st === "running";
      prog.current.perceptionFailed = st === "failed";
      setStage(b.run?.stage ?? null);
      if (b.claims.length > 0) setClaimCount(b.claims.length);
      setSteps({
        create: "done",
        upload: allUp || st ? "done" : "pending",
        perceive: st === "perceived" || st === "done" ? "done" : st === "failed" ? "failed" : "pending",
        account: b.claims.length > 0 ? "done" : "pending",
        agents: b.agentsRan ? "done" : "pending",
        done: "pending",
      });
      setResumed(true);
      if (b.claims.length > 0 && b.agentsRan) await finalize(id); // already complete: show the saved results
    })().catch((e) => !cancelled && setResumeError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const locked = sceneId !== null; // investigation settings are fixed once the scene exists
  const mark = (k: StepKey, s: StepState) => setSteps((p) => ({ ...p, [k]: s }));
  const setUpload = (c: CameraId, u: Partial<Upload>) => setUploads((p) => ({ ...p, [c]: { ...p[c], ...u } }));
  const done = steps.done === "done";
  const processed = steps.perceive === "active" || steps.perceive === "done";

  const missing = cams.filter((c) => !uploads[c].file && uploads[c].status !== "uploaded");
  const invalid = cams.filter((c) => uploads[c].file && checkFile(uploads[c].file!));
  // Incident window: bounded by the shortest uploaded recording (backend durations only).
  const allSaved = cams.every((c) => uploads[c].status === "uploaded" && uploads[c].durationS !== undefined);
  const maxS = allSaved ? Math.min(...cams.map((c) => uploads[c].durationS!)) : null;
  const win = checkWindow(winStart, winEnd, maxS);
  const winIsWhole = win.ok && maxS !== null && win.start <= 1e-6 && win.end >= maxS - 0.05;
  const winBlocked = win.ok && !BACKEND_APPLIES_WINDOW && !winIsWhole;
  // Before the uploads, the window is chosen afterwards; once uploaded, it must be valid and applicable.
  const windowReady = steps.perceive === "done" ? true : !allSaved ? steps.perceive === "pending" || steps.perceive === "failed" : win.ok && !winBlocked;
  const stmt = checkStatement(statement);
  const needsStatement = steps.account !== "done"; // once claims are saved, the statement is no longer needed
  const canRun = !busy && !done && name.trim().length > 0 && cams.length > 0 && missing.length === 0 && invalid.length === 0 && (!needsStatement || stmt.ok) && (allSaved ? windowReady : true);

  // Default the window once durations are known (10 s from 0, or the whole recording if shorter), and
  // re-clamp the end when a replacement recording is shorter.
  useEffect(() => {
    if (maxS === null) return;
    setWinEnd((e) => {
      const n = Number(e);
      if (e.trim() === "" || !Number.isFinite(n)) return String(Math.min(10, round1(maxS)));
      return n > maxS ? String(round1(maxS)) : e;
    });
  }, [maxS]);

  function pick(c: CameraId, f: File | undefined) {
    if (!f || processed || busy) return;
    const err = checkFile(f);
    setUpload(c, { file: f, status: err ? "failed" : "ready", progress: 0, error: err ?? undefined, durationS: undefined });
  }

  function toggleCam(c: CameraId) {
    if (locked) return;
    setCams((p) => (p.includes(c) ? (p.length > 1 ? p.filter((x) => x !== c) : p) : ALL_CAMS.filter((x) => x === c || p.includes(x))));
  }

  // ---------- the steps ----------

  async function create(): Promise<string> {
    mark("create", "active");
    const res = await fetch("/api/scene/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ split: "demo", room: name.trim(), cameras: cams, excludedCameras: [], plannedOcclusion: false, presynced, ...(qset ? { questionSet: qset } : {}) }),
    });
    if (res.status !== 201) throw new StepError("create", await errorOf(res, "Could not create the investigation."));
    const { sceneId: id } = (await res.json()) as { sceneId: string };
    setSceneId(id);
    window.history.replaceState(null, "", `/new?scene=${encodeURIComponent(id)}`); // a reload resumes this investigation
    mark("create", "done");
    return id;
  }

  async function uploadAll(id: string) {
    mark("upload", "active");
    let failed = 0;
    for (const c of cams) {
      const u = uploadsRef.current[c];
      if (u.status === "uploaded") continue;
      if (!u.file) throw new StepError("upload", `Camera ${c} has no recording.`);
      setUpload(c, { status: "uploading", progress: 0, error: undefined });
      try {
        const r = await uploadFile(id, c, u.file, (p) => setUpload(c, { progress: p }));
        setUpload(c, { status: "uploaded", progress: 100, durationS: r.durationS, hasAudio: r.hasAudio, warning: r.warning });
      } catch (e) {
        failed++;
        setUpload(c, { status: "failed", error: (e as Error).message });
      }
    }
    if (failed > 0) throw new StepError("upload", `${failed} recording${failed > 1 ? "s" : ""} failed to upload. Fix or replace ${failed > 1 ? "them" : "it"} and click Resume; uploaded cameras are kept.`);
    mark("upload", "done");
  }

  /** POST .../run once, then wait for run.json "perceived" on the event stream. */
  async function perceive(id: string) {
    mark("perceive", "active");
    if (!prog.current.runStarted) {
      const res = await fetch(`/api/scene/${encodeURIComponent(id)}/run`, { method: "POST" });
      if (res.status !== 202 && res.status !== 409) throw new StepError("perceive", await errorOf(res, "Could not start perception."));
      prog.current.runStarted = true; // 409: a run is already in progress; just wait for it
      prog.current.perceptionFailed = false;
    }
    await new Promise<void>((resolve, reject) => {
      esRef.current?.close();
      const es = new EventSource(`/api/scene/${encodeURIComponent(id)}/events`);
      esRef.current = es;
      es.addEventListener("run", (ev) => {
        setNotice(null);
        const run = JSON.parse((ev as MessageEvent).data) as RunStatus;
        setStage(run.stage);
        if (run.status === "perceived" || run.status === "done") {
          es.close();
          resolve();
        } else if (run.status === "failed") {
          es.close();
          prog.current.perceptionFailed = true;
          prog.current.runStarted = false; // a new run needs an explicit click
          reject(new StepError("perceive", run.error === "budget" ? "Perception stopped: the model budget is exhausted." : `Perception failed at stage "${run.stage}": ${run.error ?? "unknown error"}.`));
        }
      });
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          reject(new StepError("perceive", "Lost the progress stream. Perception may still be running on the server: click Resume to reconnect (it will not start a new run)."));
        } else setNotice("Connection to the progress stream dropped; reconnecting…");
      };
    });
    mark("perceive", "done");
  }

  async function account(id: string) {
    mark("account", "active");
    const res = await fetch(`/api/scene/${encodeURIComponent(id)}/account`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: statement.trim() }),
    });
    if (!res.ok) {
      const body = (await res.clone().json().catch(() => null)) as { code?: string } | null;
      const msg = await errorOf(res, "Statement analysis failed.");
      const hint =
        body?.code === "not_a_statement" || body?.code === "no_claims_proposed" || body?.code === "claims_rejected"
          ? " Edit the statement, then click Retry statement analysis (perception is not repeated)."
          : body?.code === "model_output_invalid" || body?.code === "model_unavailable"
            ? " The statement is fine; click Retry statement analysis to try the model again."
            : "";
      throw new StepError("account", res.status === 429 || res.status === 503 ? `Budget guard stopped the analysis: ${msg}` : msg + hint);
    }
    const results = (await res.json()) as unknown;
    if (!Array.isArray(results) || results.length === 0)
      throw new StepError("account", "No verifiable claims were extracted from the statement. Rephrase it and retry the statement analysis.");
    setClaimCount(results.length);
    mark("account", "done");
  }

  /** The saved claims count: agents need claims.json to hold this account's claims. */
  async function savedClaims(id: string): Promise<number> {
    const res = await fetch(`/api/scene/${encodeURIComponent(id)}/results`, { cache: "no-store" });
    if (!res.ok) throw new StepError("account", await errorOf(res, "Could not read the saved claims."));
    const body = (await res.json()) as { claims?: unknown[] };
    return Array.isArray(body.claims) ? body.claims.length : 0;
  }

  async function agents(id: string) {
    if ((await savedClaims(id)) === 0) {
      mark("agents", "pending");
      throw new StepError("account", "The statement analysis saved no claims, so there is nothing for the agents to check. Retry the statement analysis (perception is not repeated).");
    }
    mark("agents", "active");
    setAgentSteps([]);
    const seen = new Set<string>();
    const es = new EventSource(`/api/scene/${encodeURIComponent(id)}/events`);
    esRef.current = es;
    es.addEventListener("reset", () => {
      seen.clear();
      setAgentSteps([]);
    });
    es.addEventListener("step", (ev) => {
      const s = JSON.parse((ev as MessageEvent).data) as AgentStep;
      const key = `${s.agent}|${s.claimId}|${s.n}`;
      if (seen.has(key)) return; // a reconnect resends every step
      seen.add(key);
      setAgentSteps((p) => [...p, s]);
    });
    try {
      const res = await fetch(`/api/scene/${encodeURIComponent(id)}/agents`, { method: "POST" });
      if (!res.ok) throw new StepError("agents", await errorOf(res, "Agent analysis failed."));
      const body = (await res.json()) as { claims: { ran: boolean }[] };
      setAgentsRan(body.claims.filter((c) => c.ran).length);
    } finally {
      es.close();
    }
    mark("agents", "done");
  }

  async function finalize(id: string) {
    const res = await fetch(`/api/scene/${encodeURIComponent(id)}/results`, { cache: "no-store" });
    if (!res.ok) throw new StepError("done", await errorOf(res, "Could not read the saved results."));
    const body = (await res.json()) as { claims: unknown[]; results: ClaimResult[] };
    const counts = { Supported: 0, Contradicted: 0, Insufficient: 0 };
    for (const r of body.results) counts[r.verdict]++;
    setSummary({ claims: body.claims.length, counts });
    mark("done", "done");
  }

  async function runInvestigation() {
    if (busy) return; // no duplicate runs
    setBusy(true);
    setError(null);
    setNotice(null);
    setStartedAt((s) => s ?? Date.now());
    setNow(Date.now());
    try {
      const id = sceneId ?? (await create());
      if (!prog.current.runStarted && steps.perceive !== "done") {
        await uploadAll(id); // skips cameras already saved
        // The window can only be chosen once the backend reports the durations: if this click came before
        // that (or the window is not applicable), stop here; nothing billable has started.
        if (!(allSaved && windowReady)) {
          setNotice("Recordings saved. Review the incident window, then click Start processing.");
          return;
        }
      }
      if (steps.perceive !== "done") await perceive(id);
      if (steps.account !== "done") await account(id);
      if (steps.agents !== "done") await agents(id);
      await finalize(id);
    } catch (e) {
      const step = e instanceof StepError ? e.step : null;
      if (step) mark(step, "failed");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshResults() {
    if (!sceneId) return;
    try {
      await finalize(sceneId);
      mark("done", "pending"); // initial results only: agents did not finish
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startOver() {
    if (busy) return;
    esRef.current?.close();
    prog.current = { runStarted: false, perceptionFailed: false };
    setSceneId(null);
    setSteps(freshSteps());
    setUploads(emptyUploads());
    setError(null);
    setStage(null);
    setClaimCount(null);
    setAgentSteps([]);
    setAgentsRan(null);
    setSummary(null);
    setStartedAt(null);
    setStatement("");
    setWinStart("0");
    setWinEnd("");
    setNotice(null);
    window.history.replaceState(null, "", "/new");
  }

  const elapsed = startedAt ? Math.max(0, Math.round(((busy ? now : now || Date.now()) - startedAt) / 1000)) : 0;
  const runLabel = busy
    ? "Running…"
    : done
      ? "Investigation complete"
      : !sceneId
      ? "Run Investigation"
      : steps.perceive === "failed" && prog.current.perceptionFailed
        ? "Retry perception"
        : steps.account === "failed"
          ? "Retry statement analysis"
          : steps.agents === "failed"
            ? "Retry agents"
            : steps.upload === "done" && steps.perceive === "pending"
              ? "Start processing"
              : "Resume";
  const agentsIncomplete = steps.account === "done" && steps.agents !== "done";

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "100px clamp(16px,3vw,40px) 80px", maxWidth: 1320, margin: "0 auto", boxSizing: "border-box", color: C.text }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 32 }}>
        <div>
          <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: C.dim }}>
            {sceneId ? `SCENE ${sceneId}` : "LOCAL INVESTIGATION"}
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }}>New Investigation</h1>
          <p style={{ margin: "14px 0 0", color: C.muted, fontSize: 16, maxWidth: 620 }}>Upload synchronized camera recordings and check a witness account against the evidence.</p>
        </div>
        {sceneId && !busy && (
          <button type="button" onClick={startOver} className="rs-btn rs-btn-ghost" style={{ padding: "10px 18px", fontSize: 14, color: C.text }}>
            Start a new investigation
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,520px),1fr))", gap: 16, alignItems: "start" }}>
        {/* ---------- left: the form ---------- */}
        <div style={{ display: "grid", gap: 16 }}>
          <section style={CARD}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Investigation details</h3>
            <label style={{ display: "block", marginTop: 18 }}>
              <span className="rs-mono" style={LABEL}>Investigation name</span>
              <input value={name} disabled={locked} onChange={(e) => setName(e.target.value)} placeholder="Factory forklift near miss" style={{ ...INPUT, marginTop: 8, opacity: locked ? 0.6 : 1 }} />
            </label>

            <div style={{ marginTop: 18 }}>
              <span className="rs-mono" style={LABEL}>Cameras</span>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {ALL_CAMS.map((c) => {
                  const on = cams.includes(c);
                  return (
                    <button key={c} type="button" disabled={locked} onClick={() => toggleCam(c)} aria-pressed={on} className="rs-mono"
                      style={{ width: 52, height: 40, borderRadius: 999, cursor: locked ? "default" : "pointer", fontSize: 13, background: on ? "rgba(124,199,255,0.12)" : "transparent", color: on ? C.text : C.faint, border: `1px solid ${on ? "rgba(124,199,255,0.5)" : "rgba(236,230,218,0.14)"}`, opacity: locked && !on ? 0.4 : 1 }}>
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            <label style={{ display: "block", marginTop: 18 }}>
              <span className="rs-mono" style={LABEL}>Scenario</span>
              <select value={qset} disabled={locked} onChange={(e) => setQset(e.target.value)} style={{ ...INPUT, marginTop: 8, opacity: locked ? 0.6 : 1 }}>
                {QUESTION_SETS.map((q) => (
                  <option key={q.value || "auto"} value={q.value}>{q.label}</option>
                ))}
              </select>
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: C.dim, lineHeight: "19px" }}>
                {QUESTION_SETS.find((q) => q.value === qset)?.help} Fixed question sets are scenario-specific: pick one only if the footage shows that scenario.
              </span>
            </label>

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18, cursor: locked ? "default" : "pointer" }}>
              <input type="checkbox" checked={presynced} disabled={locked} onChange={(e) => setPresynced(e.target.checked)} style={{ marginTop: 3, accentColor: C.coral }} />
              <span>
                <span style={{ fontSize: 15 }}>Recordings are already synchronized</span>
                <span style={{ display: "block", fontSize: 13, color: C.dim, lineHeight: "19px", marginTop: 2 }}>
                  Tick only if all files start at the same moment (e.g. exported from one rig). Otherwise the backend&rsquo;s clap-and-flash sync is used, which needs a visible flash and audible clap in every recording.
                </span>
              </span>
            </label>
          </section>

          <section style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Camera recordings</h3>
              <span className="rs-mono" style={{ fontSize: 12, color: C.dim }}>.mp4 / .webm / .mov · up to {MAX_MB} MB each</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))", gap: 12, marginTop: 16 }}>
              {cams.map((c) => (
                <CameraCard key={c} camera={c} upload={uploads[c]} disabled={processed || busy} onPick={(f) => pick(c, f)} />
              ))}
            </div>
          </section>

          {allSaved && maxS !== null && (
            <section style={CARD}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Incident window</h3>
                <span className="rs-mono" style={{ fontSize: 12, color: C.dim }}>available 0–{maxS.toFixed(1)} s (shortest recording)</span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: C.dim, lineHeight: "19px" }}>
                Only this part of the recordings is analysed, on the original timeline; the recordings themselves are not trimmed.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,140px),1fr))", gap: 12, marginTop: 14 }}>
                {([["Start (s)", winStart, setWinStart], ["End (s)", winEnd, setWinEnd]] as const).map(([label, v, set]) => (
                  <label key={label}>
                    <span className="rs-mono" style={LABEL}>{label}</span>
                    <input type="number" inputMode="decimal" step="0.1" min={0} max={maxS} value={v} disabled={busy || processed}
                      onChange={(e) => set(e.target.value)} style={{ ...INPUT, marginTop: 8 }} />
                  </label>
                ))}
              </div>
              {win.ok ? (
                <div className="rs-mono" style={{ marginTop: 12, fontSize: 12, color: C.muted, lineHeight: "20px" }}>
                  Window {win.start.toFixed(1)}–{win.end.toFixed(1)} s · {(win.end - win.start).toFixed(1)} s selected
                  <span style={{ display: "block" }}>
                    Estimated model calls ≈ {CALLS_PER_SECOND} × {(win.end - win.start).toFixed(1)} s ≈ {Math.round(CALLS_PER_SECOND * (win.end - win.start))}
                    <span style={{ color: C.dim }}> (approximation, not actual usage or cost)</span>
                  </span>
                  {CALLS_PER_SECOND * (win.end - win.start) > EXPENSIVE_CALLS && (
                    <span style={{ display: "block", color: C.amber }}>Long window: processing can be slow and expensive. Narrow it to the incident if you can.</span>
                  )}
                </div>
              ) : (
                win.error && <div style={{ marginTop: 12, fontSize: 13, color: C.coral }}>{win.error}</div>
              )}
              {winBlocked && (
                <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,194,61,0.35)", background: "rgba(255,194,61,0.06)", fontSize: 13, lineHeight: "19px", color: C.text }}>
                  The backend does not apply an incident window yet, so this run would analyse the whole recording instead of {win.ok ? `${win.start.toFixed(1)}–${win.end.toFixed(1)} s` : "the selection"}. Processing is blocked until it does.
                  <button type="button" disabled={busy || processed} onClick={() => { setWinStart("0"); setWinEnd(String(maxS)); }} className="rs-btn rs-btn-ghost" style={{ display: "block", marginTop: 8, padding: "6px 12px", fontSize: 13, color: C.text }}>
                    Use the whole recording (0–{maxS.toFixed(1)} s)
                  </button>
                </div>
              )}
            </section>
          )}

          <section style={CARD}>
            <label style={{ display: "block" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Witness Statement</h3>
              <textarea value={statement} disabled={busy || steps.account === "done"} onChange={(e) => setStatement(e.target.value)} rows={5}
                placeholder="The forklift approached the worker. I stepped aside before it reached me, and the forklift never touched me."
                style={{ ...INPUT, marginTop: 12, resize: "vertical", lineHeight: "22px" }} />
            </label>
            {resumed && needsStatement && !statement.trim() && (
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: C.amber }}>The statement is not stored with the investigation: enter it again to continue.</span>
            )}
            {needsStatement && statement.trim() !== "" && !stmt.ok ? (
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: C.coral }}>{stmt.reason}</span>
            ) : (
              <span style={{ display: "block", marginTop: 8, fontSize: 13, color: C.dim }}>Plain text, no timestamps needed. Each sentence becomes one or more claims, each labelled against the footage.</span>
            )}
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <button type="button" onClick={runInvestigation} disabled={!canRun} className="rs-btn rs-btn-primary"
              style={{ padding: "15px 28px", fontSize: 15, fontWeight: 600, cursor: canRun ? "pointer" : "not-allowed", opacity: canRun ? 1 : 0.45, border: 0 }}>
              {runLabel}
            </button>
            {!busy && !done && (
              <span style={{ fontSize: 13, color: C.dim }}>
                {!name.trim() ? "Enter an investigation name." : allSaved && !win.ok ? "Fix the incident window." : winBlocked ? "The selected window cannot be applied yet (see Incident window)." : missing.length ? `Add a recording for camera ${missing.join(", ")}.` : invalid.length ? `Replace the invalid recording for camera ${invalid.join(", ")}.` : needsStatement && !stmt.ok ? "Enter a witness statement that describes what happened." : sceneId ? "Resumes from the first unfinished step with the same investigation." : "Runs perception and model calls on your configured API key."}
              </span>
            )}
          </div>
        </div>

        {/* ---------- right: progress / results ---------- */}
        <div style={{ display: "grid", gap: 16, position: "sticky", top: 96 }}>
          <section style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Investigation Progress</h3>
              {startedAt && <span className="rs-mono" style={{ fontSize: 12, color: busy ? C.blue : C.dim }}>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
            </div>
            <ol style={{ listStyle: "none", margin: "18px 0 0", padding: 0, display: "grid", gap: 4 }}>
              {STEPS.map((s) => {
                const st = steps[s.key];
                const color = st === "done" ? C.green : st === "active" ? C.blue : st === "failed" ? C.coral : C.faint;
                return (
                  <li key={s.key} style={{ display: "flex", gap: 12, padding: "10px 12px", borderRadius: 12, background: st === "active" ? "rgba(124,199,255,0.07)" : "transparent", border: `1px solid ${st === "active" ? "rgba(124,199,255,0.25)" : "transparent"}` }}>
                    <span className="rs-mono" aria-hidden style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", border: `1.5px solid ${color}`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                      {st === "done" ? "✓" : st === "failed" ? "!" : st === "active" ? <Spinner /> : ""}
                    </span>
                    <span>
                      <span style={{ fontSize: 15, color: st === "pending" ? C.dim : C.text }}>{s.label}</span>
                      {(st === "active" || (s.key === "done" && st === "done")) && <span style={{ display: "block", fontSize: 13, color: C.muted, marginTop: 2 }}>{s.help}</span>}
                      {s.key === "upload" && st !== "pending" && (
                        <span className="rs-mono" style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 2 }}>{cams.filter((c) => uploads[c].status === "uploaded").length}/{cams.length} cameras saved</span>
                      )}
                      {s.key === "perceive" && st === "active" && stage && <span className="rs-mono" style={{ display: "block", fontSize: 12, color: C.blue, marginTop: 4 }}>{STAGE_TEXT[stage] ?? stage}</span>}
                      {s.key === "account" && claimCount !== null && <span className="rs-mono" style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 2 }}>{claimCount} claim{claimCount === 1 ? "" : "s"} analyzed</span>}
                      {s.key === "agents" && (st === "active" || st === "done") && (
                        <span className="rs-mono" style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 2 }}>
                          {agentSteps.length} agent step{agentSteps.length === 1 ? "" : "s"}{agentsRan !== null ? ` · ${agentsRan} claim${agentsRan === 1 ? "" : "s"} investigated` : ""}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
            {steps.agents === "active" && agentSteps.length > 0 && (
              <div className="rs-mono" style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#0A0B0D", fontSize: 12, lineHeight: "20px", color: C.muted }}>
                {agentSteps.slice(-5).map((s) => (
                  <div key={`${s.agent}|${s.claimId}|${s.n}`}>{describeStep(s)}</div>
                ))}
              </div>
            )}
            {notice && <p style={{ margin: "12px 0 0", fontSize: 13, color: C.amber }}>{notice}</p>}
            {resumeError && <p style={{ margin: "12px 0 0", fontSize: 13, color: C.coral }}>{resumeError}</p>}
            {error && (
              <div role="alert" style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,90,71,0.4)", background: "rgba(255,90,71,0.08)", color: C.text, fontSize: 14, lineHeight: "20px" }}>
                <span className="rs-mono" style={{ ...LABEL, color: C.coral, display: "block", marginBottom: 4 }}>Error</span>
                {error}
                {steps.perceive === "failed" && prog.current.perceptionFailed && <span style={{ display: "block", marginTop: 6, color: C.muted }}>Retrying perception starts a new (billable) run.</span>}
              </div>
            )}
            {agentsIncomplete && !busy && steps.agents === "failed" && sceneId && (
              <div style={{ marginTop: 14, fontSize: 14, color: C.muted, lineHeight: "20px" }}>
                <span style={{ color: C.amber }}>Agent analysis is incomplete.</span> The initial results are saved; open them now or retry the agents.
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                  <Link href={`/board?scene=${sceneDir(sceneId)}`} className="rs-btn rs-btn-ghost" style={{ padding: "10px 16px", fontSize: 14, color: C.text }}>Open board (initial results)</Link>
                  <button type="button" onClick={refreshResults} className="rs-btn rs-btn-ghost" style={{ padding: "10px 16px", fontSize: 14, color: C.text }}>Show saved counts</button>
                </div>
              </div>
            )}
          </section>

          {summary && sceneId && (
            <section style={{ ...CARD, border: `1px solid ${done ? "rgba(91,228,155,0.35)" : "rgba(255,194,61,0.35)"}` }}>
              <span className="rs-mono" style={{ ...LABEL, color: done ? C.green : C.amber }}>{done ? "Investigation complete" : "Initial results (agents incomplete)"}</span>
              <h3 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>{name}</h3>
              <div className="rs-mono" style={{ marginTop: 6, fontSize: 12, color: C.dim }}>
                SCENE {sceneId} · {cams.length} camera{cams.length === 1 ? "" : "s"} · {summary.claims} claim{summary.claims === 1 ? "" : "s"} · agents {steps.agents === "done" ? "complete" : "incomplete"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,110px),1fr))", gap: 10, marginTop: 18 }}>
                {([["Supported", C.green], ["Contradicted", C.coral], ["Insufficient", C.amber]] as const).map(([v, col]) => (
                  <div key={v} style={{ padding: "14px 12px", borderRadius: 14, background: "#0A0B0D", border: "1px solid rgba(236,230,218,0.08)" }}>
                    <div style={{ fontSize: 28, fontWeight: 500, color: col }}>{summary.counts[v]}</div>
                    <div className="rs-mono" style={{ ...LABEL, marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 13, color: C.dim }}>Counts are read from the saved results{done ? ", after the agents finished" : ""}.</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
                <Link href={`/board?scene=${sceneDir(sceneId)}`} className="rs-btn rs-btn-primary" style={{ padding: "13px 22px", fontSize: 15 }}>Open Investigation Board</Link>
                <Link href={`/proof?scene=${sceneDir(sceneId)}`} className="rs-btn rs-btn-ghost" style={{ padding: "13px 22px", fontSize: 15, color: C.text }}>Inspect Evidence</Link>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function describeStep(s: AgentStep): string {
  const who = s.agent === "skeptic" ? "Skeptic" : "Investigator";
  if (s.action === "inspect_window" && "camera_id" in s.args) {
    const w = s.checkedWindow ?? [s.args.start_s, s.args.end_s];
    return `${who} · inspected cam ${s.args.camera_id} ${w[0].toFixed(1)}–${w[1].toFixed(1)} s`;
  }
  if (s.action === "stop") return `${who} · finished`;
  return `${who} · request rejected${s.rejectionReason ? `: ${s.rejectionReason}` : ""}`;
}

function Spinner() {
  return <span style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid rgba(124,199,255,0.3)", borderTopColor: "#7CC7FF", animation: "rsSpin 0.8s linear infinite", display: "block" }} />;
}

function CameraCard({ camera, upload, disabled, onPick }: { camera: CameraId; upload: Upload; disabled: boolean; onPick: (f: File | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { file, status, progress, error, savedName } = upload;
  const tone = status === "uploaded" ? C.green : status === "uploading" ? C.blue : status === "failed" ? C.coral : status === "ready" ? C.text : C.faint;
  const statusText = status === "uploaded" ? `Saved · ${upload.durationS?.toFixed(1) ?? "?"} s` : status === "uploading" ? `Uploading ${progress}%` : status === "failed" ? "Failed" : status === "ready" ? "Ready to upload" : "No recording";
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onPick(e.dataTransfer.files[0]);
      }}
      style={{ borderRadius: 16, padding: 16, background: over ? "rgba(124,199,255,0.06)" : "#0A0B0D", border: `1px ${file ? "solid" : "dashed"} ${over ? "rgba(124,199,255,0.6)" : status === "failed" ? "rgba(255,90,71,0.45)" : "rgba(236,230,218,0.14)"}`, minHeight: 132, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="rs-mono" style={{ fontSize: 13, letterSpacing: "0.12em" }}>CAMERA {camera}</span>
        <span className="rs-mono" style={{ fontSize: 11, color: tone }}>{statusText}</span>
      </div>
      {file ? (
        <div style={{ fontSize: 14, wordBreak: "break-all" }}>
          {file.name}
          <span className="rs-mono" style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 2 }}>{mb(file.size)}</span>
        </div>
      ) : savedName ? (
        <div style={{ fontSize: 14, color: C.muted }}>{savedName}</div>
      ) : (
        <div style={{ fontSize: 13, color: C.dim }}>Drop a .mp4, .webm or .mov here, or choose a file.</div>
      )}
      {status === "uploading" && (
        <div style={{ height: 3, borderRadius: 2, background: "rgba(236,230,218,0.08)", overflow: "hidden" }}>
          <div style={{ width: `${progress}%`, height: "100%", background: C.blue, transition: "width .2s" }} />
        </div>
      )}
      {status === "uploaded" && (
        <div className="rs-mono" style={{ fontSize: 11, color: upload.hasAudio ? C.dim : C.amber }}>{upload.hasAudio ? "audio track" : "no audio track"}</div>
      )}
      {status === "uploaded" && upload.warning && <div style={{ fontSize: 12, color: C.amber, lineHeight: "17px" }}>{upload.warning}</div>}
      {error && <div style={{ fontSize: 12, color: C.coral, lineHeight: "17px" }}>{error}</div>}
      <div style={{ marginTop: "auto" }}>
        <input ref={input} type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }} />
        {status !== "uploaded" || !disabled ? (
          <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="rs-btn rs-btn-ghost" style={{ padding: "8px 14px", fontSize: 13, color: C.text, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}>
            {file || savedName ? "Replace file" : "Choose file"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
