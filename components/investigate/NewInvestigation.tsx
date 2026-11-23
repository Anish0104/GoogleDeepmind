// OWNER: Dev 4. The New Investigation wizard: set up the scene, add one recording per camera
// (file upload or a phone on /phone), add the witness statement, then run perception, the
// account and the agents in order, and open the board and proof for the new scene.
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CameraId, RunStatus, Verdict } from "@/lib/types";
import { VERDICT_STYLE } from "@/components/verdictStyle";
import {
  ALL_CAMERAS,
  type AgentOutcome,
  type InvestigationForm,
  createInvestigation,
  phoneLink,
  runAgents,
  runPhase,
  sceneBoardHref,
  sceneProofHref,
  startRun,
  submitAccount,
  uploadRecording,
  waitForPerceived,
} from "./api";

const CARD = { border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, background: "rgba(15,17,23,0.65)", backdropFilter: "blur(20px)", padding: 26, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" } as const;
const LABEL = { display: "block", fontSize: 13, color: "#94A3B8", marginBottom: 8 } as const;
const INPUT = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(8,9,11,0.8)",
  color: "#FAF8F5",
  fontSize: 15,
  fontFamily: "inherit",
} as const;
const STEPS = ["Setup", "Footage", "Statement", "Process", "Results"];

type Footage = { mode: "file" | "phone"; file?: File; state: "idle" | "uploading" | "done" | "error"; error?: string };
type StageKey = "perceive" | "account" | "agents";
type Stage = { state: "waiting" | "running" | "done" | "error"; detail: string };
const STAGE_NAMES: Record<StageKey, string> = {
  perceive: "Perception: read every camera",
  account: "Account: split the statement into claims and label them",
  agents: "Agents: Investigator and Skeptic check each claim",
};
const STAGE_ORDER: StageKey[] = ["perceive", "account", "agents"];

function Btn({ children, onClick, disabled, kind = "primary" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; kind?: "primary" | "line" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rs-btn ${kind === "primary" ? "rs-btn-primary" : "rs-btn-line"}`}
      style={{ padding: "12px 22px", fontSize: 14, opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {children}
    </button>
  );
}

function ErrorLine({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p role="alert" style={{ margin: "12px 0 0", fontSize: 13, color: "#FF5A47" }}>
      {text}
    </p>
  );
}

export function NewInvestigation({ questionSets }: { questionSets: string[] }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<InvestigationForm>({ room: "", cameras: [...ALL_CAMERAS], excluded: [], questionSet: "" });
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [footage, setFootage] = useState<Partial<Record<CameraId, Footage>>>({});
  const [transcript, setTranscript] = useState("");
  const [stages, setStages] = useState<Record<StageKey, Stage>>({
    perceive: { state: "waiting", detail: "" },
    account: { state: "waiting", detail: "" },
    agents: { state: "waiting", detail: "" },
  });
  const [results, setResults] = useState<{ claimId: string; verdict: Verdict }[]>([]);
  const [outcomes, setOutcomes] = useState<AgentOutcome[]>([]);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const toggle = (list: CameraId[], c: CameraId) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  const cams = ALL_CAMERAS.filter((c) => form.cameras.includes(c));
  const camFootage = (c: CameraId): Footage => footage[c] ?? { mode: "file", state: "idle" };
  const setCam = (c: CameraId, patch: Partial<Footage>) => setFootage((f) => ({ ...f, [c]: { ...camFootage(c), ...f[c], ...patch } }));

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      setSceneId(await createInvestigation(form));
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAll() {
    if (!sceneId) return;
    setBusy(true);
    setError(undefined);
    let ok = true;
    for (const c of cams) {
      const f = camFootage(c);
      if (f.mode !== "file" || f.state === "done") continue;
      if (!f.file) {
        ok = false;
        setCam(c, { state: "error", error: "Choose a video file." });
        continue;
      }
      setCam(c, { state: "uploading", error: undefined });
      try {
        await uploadRecording(sceneId, c, f.file);
        setCam(c, { state: "done" });
      } catch (e) {
        ok = false;
        setCam(c, { state: "error", error: (e as Error).message });
      }
    }
    setBusy(false);
    if (ok) setStep(2);
  }

  const footageReady = cams.every((c) => {
    const f = camFootage(c);
    return f.mode === "phone" ? f.state === "done" : f.state === "done" || !!f.file;
  });

  const setStage = (k: StageKey, s: Stage) => setStages((all) => ({ ...all, [k]: s }));

  async function process(from: StageKey = "perceive") {
    if (!sceneId) return;
    setStep(3);
    setBusy(true);
    for (const k of STAGE_ORDER.slice(STAGE_ORDER.indexOf(from))) {
      setStage(k, { state: "running", detail: "" });
      try {
        if (k === "perceive") {
          const waiting = waitForPerceived(sceneId, {
            onRun: (r: RunStatus) => setStage("perceive", { state: "running", detail: runPhase(r).label }),
          });
          try {
            await startRun(sceneId);
          } catch (e) {
            // 409: a run is already going for this scene; keep waiting on its saved status.
            if ((e as { status?: number }).status !== 409) throw e;
          }
          await waiting;
          setStage(k, { state: "done", detail: "Footage read" });
        } else if (k === "account") {
          const out = await submitAccount(sceneId, transcript);
          setResults(out.map((r) => ({ claimId: r.claimId, verdict: r.verdict })));
          setStage(k, { state: "done", detail: `${out.length} claim${out.length === 1 ? "" : "s"} labelled` });
        } else {
          const out = await runAgents(sceneId);
          setOutcomes(out);
          const changed = out.filter((o) => o.ran && o.before && o.after && o.before !== o.after).length;
          const ran = out.filter((o) => o.ran).length;
          setStage(k, { state: "done", detail: `${ran} agent run${ran === 1 ? "" : "s"}, ${changed} label change${changed === 1 ? "" : "s"}` });
        }
      } catch (e) {
        setStage(k, { state: "error", detail: (e as Error).message });
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setStep(4);
  }

  const finalVerdict = (claimId: string, initial: Verdict): Verdict => {
    const o = outcomes.find((x) => x.claimId === claimId);
    return o?.after ?? initial;
  };

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "100px clamp(16px,3vw,40px) 80px", maxWidth: 960, margin: "0 auto", boxSizing: "border-box" }}>
      <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#7D838C" }}>
        {sceneId ? `SCENE ${sceneId}` : "NEW SCENE"}
      </div>
      <h1 style={{ margin: "10px 0 0", fontSize: "clamp(36px,4.4vw,56px)", fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }}>
        New <span style={{ fontWeight: 400, color: "#9AA0A8" }}>investigation</span>
      </h1>

      <ol className="rs-mono" aria-label="Steps" style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: "24px 0 24px", fontSize: 12 }}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${i === step ? "rgba(124,199,255,0.5)" : "rgba(236,230,218,0.1)"}`,
              color: i < step ? "#5BE49B" : i === step ? "#ECE6DA" : "#7D838C",
            }}
          >
            {i < step ? "✓ " : `${i + 1} `}
            {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section style={CARD}>
          <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 500 }}>Set up the scene</h2>
          <label style={LABEL} htmlFor="room">
            Room or location
          </label>
          <input id="room" style={INPUT} value={form.room} placeholder="e.g. Kitchen, warehouse floor" onChange={(e) => setForm({ ...form, room: e.target.value })} />

          <fieldset style={{ border: 0, padding: 0, margin: "20px 0 0" }}>
            <legend style={LABEL}>Cameras</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              {ALL_CAMERAS.map((c) => {
                const on = form.cameras.includes(c);
                const ex = form.excluded.includes(c);
                return (
                  <div key={c} style={{ border: `1px solid ${on ? "rgba(236,230,218,0.24)" : "rgba(236,230,218,0.08)"}`, borderRadius: 14, padding: 12 }}>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15, cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => setForm({ ...form, cameras: toggle(form.cameras, c), excluded: form.excluded.filter((x) => x !== c) })} />
                      CAM {c}
                    </label>
                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#9AA0A8", marginTop: 8, opacity: on ? 1 : 0.4 }}>
                      <input type="checkbox" disabled={!on} checked={ex} onChange={() => setForm({ ...form, excluded: toggle(form.excluded, c) })} />
                      Exclude from analysis
                    </label>
                  </div>
                );
              })}
            </div>
          </fieldset>

          <label style={{ ...LABEL, marginTop: 20 }} htmlFor="qset">
            Question set
          </label>
          <select id="qset" style={INPUT} value={form.questionSet} onChange={(e) => setForm({ ...form, questionSet: e.target.value })}>
            <option value="">Automatic (scout writes the questions)</option>
            {questionSets.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>

          <div style={{ marginTop: 24 }}>
            <Btn onClick={create} disabled={busy || !form.room.trim() || form.cameras.length === 0}>
              {busy ? "Creating…" : "Create scene"}
            </Btn>
          </div>
          <ErrorLine text={error} />
        </section>
      )}

      {step === 1 && sceneId && (
        <section style={CARD}>
          <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 500 }}>Add one recording per camera</h2>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "#9AA0A8" }}>
            Upload a video file, or record live on a phone. Start every camera before the clap and flash so they can be synced.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {cams.map((c) => {
              const f = camFootage(c);
              const link = phoneLink(origin, sceneId, c);
              return (
                <div key={c} style={{ border: "1px solid rgba(236,230,218,0.1)", borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <strong style={{ fontWeight: 500 }}>
                      CAM {c}
                      {form.excluded.includes(c) && <span className="rs-mono" style={{ marginLeft: 8, fontSize: 11, color: "#FFC23D" }}>excluded</span>}
                    </strong>
                    <div className="rs-mono" role="radiogroup" aria-label={`CAM ${c} source`} style={{ display: "flex", gap: 6, fontSize: 12 }}>
                      {(["file", "phone"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={f.mode === m}
                          disabled={f.state === "done" || f.state === "uploading"}
                          onClick={() => setCam(c, { mode: m, state: "idle", error: undefined })}
                          className="rs-btn rs-btn-line"
                          style={{ padding: "6px 12px", background: f.mode === m ? "rgba(236,230,218,0.1)" : "transparent" }}
                        >
                          {m === "file" ? "Upload file" : "Record on phone"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {f.mode === "file" ? (
                    <div style={{ marginTop: 12, fontSize: 13, color: "#9AA0A8" }}>
                      {f.state === "done" ? (
                        <span style={{ color: "#5BE49B" }}>Uploaded {f.file?.name}</span>
                      ) : (
                        <input
                          type="file"
                          accept="video/*,.mov,.mp4,.webm"
                          aria-label={`Video for CAM ${c}`}
                          disabled={f.state === "uploading"}
                          onChange={(e) => setCam(c, { file: e.target.files?.[0], state: "idle", error: undefined })}
                          style={{ color: "#C9C2B4", maxWidth: "100%" }}
                        />
                      )}
                      {f.state === "uploading" && <span style={{ marginLeft: 8 }}>Uploading…</span>}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 13, color: "#9AA0A8", display: "flex", flexDirection: "column", gap: 8 }}>
                      <span>
                        Open on the phone for CAM {c}:{" "}
                        <a href={link} target="_blank" rel="noreferrer" className="rs-mono" style={{ wordBreak: "break-all" }}>
                          {link}
                        </a>
                      </span>
                      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input type="checkbox" checked={f.state === "done"} onChange={(e) => setCam(c, { state: e.target.checked ? "done" : "idle" })} />
                        This phone has stopped and finished uploading
                      </label>
                    </div>
                  )}
                  <ErrorLine text={f.error} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn onClick={uploadAll} disabled={busy || !footageReady}>
              {busy ? "Uploading…" : "Continue"}
            </Btn>
          </div>
        </section>
      )}

      {step === 2 && (
        <section style={CARD}>
          <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 500 }}>Witness statement</h2>
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "#9AA0A8" }}>
            Paste or type what the witness says happened. It is split into claims, and each claim is checked against the footage.
          </p>
          <label style={LABEL} htmlFor="transcript">
            Statement
          </label>
          <textarea
            id="transcript"
            rows={8}
            style={{ ...INPUT, resize: "vertical", lineHeight: 1.5 }}
            value={transcript}
            placeholder="I walked in, put the red cup on the shelf, and left by the back door."
            onChange={(e) => setTranscript(e.target.value)}
          />
          <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn kind="line" onClick={() => setStep(1)}>
              Back
            </Btn>
            <Btn onClick={() => void process()} disabled={!transcript.trim()}>
              Process investigation
            </Btn>
          </div>
        </section>
      )}

      {step >= 3 && sceneId && (
        <section style={{ ...CARD, marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 500 }}>Processing</h2>
          <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {STAGE_ORDER.map((k) => {
              const s = stages[k];
              const color = s.state === "done" ? "#5BE49B" : s.state === "error" ? "#FF5A47" : s.state === "running" ? "#7CC7FF" : "#5E646D";
              return (
                <li key={k} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span
                    aria-hidden
                    style={{ flex: "none", width: 10, height: 10, marginTop: 6, borderRadius: "50%", background: color, boxShadow: s.state === "running" ? `0 0 12px ${color}` : "none" }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15 }}>{STAGE_NAMES[k]}</div>
                    <div className="rs-mono" style={{ fontSize: 12, color: s.state === "error" ? "#FF5A47" : "#7D838C", marginTop: 2, overflowWrap: "anywhere" }}>
                      {s.state === "waiting" ? "waiting" : s.detail || (s.state === "running" ? "working…" : "")}
                    </div>
                    {s.state === "error" && !busy && (
                      <div style={{ marginTop: 8 }}>
                        <Btn kind="line" onClick={() => void process(k)}>
                          Retry from here
                        </Btn>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {step === 4 && sceneId && (
        <section style={CARD}>
          <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 500 }}>Results</h2>
          {results.length === 0 && <p style={{ margin: 0, fontSize: 14, color: "#9AA0A8" }}>No claims came out of the statement.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((r) => {
              const v = finalVerdict(r.claimId, r.verdict);
              const st = VERDICT_STYLE[v];
              return (
                <Link
                  key={r.claimId}
                  href={sceneProofHref(sceneId, r.claimId)}
                  className="rs-tile"
                  style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(236,230,218,0.1)", color: "#ECE6DA" }}
                >
                  <span className="rs-mono" style={{ fontSize: 13 }}>
                    {r.claimId}
                  </span>
                  <span className="rs-mono" style={{ fontSize: 12, color: st.color }}>
                    {v}
                    {v !== r.verdict && <span style={{ color: "#7D838C" }}> (was {r.verdict})</span>}
                  </span>
                </Link>
              );
            })}
          </div>
          <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={sceneBoardHref(sceneId)} className="rs-btn rs-btn-primary" style={{ padding: "12px 22px", fontSize: 14 }}>
              Open the board
            </Link>
            {results[0] && (
              <Link href={sceneProofHref(sceneId, results[0].claimId)} className="rs-btn rs-btn-line" style={{ padding: "12px 22px", fontSize: 14, color: "#ECE6DA" }}>
                Open proof
              </Link>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
