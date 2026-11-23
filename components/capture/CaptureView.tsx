// OWNER: Dev 4. The Capture screen: the rig, clap + flash sync, the spoken account split
// into claims, and the pipeline progress. A scripted walkthrough over the demo scene; the
// real capture flow lives on /phone (Dev 1).
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { CameraId, Claim, SceneManifest } from "@/lib/types";
import { SYNC_OFFSETS, drawSync } from "@/components/canvas/drawSync";
import { pct } from "@/components/canvas/math";
import { VIEWS } from "@/components/canvas/scene";
import { useSite } from "@/components/site/SiteStore";
import { useCanvasLoop } from "@/components/site/useCanvasLoop";
import { STAGES, accountText, offsetText, splitClaims, splitTotal, stageProgress } from "./split";

const CARD = { border: "1px solid rgba(236,230,218,0.09)", borderRadius: 20, background: "#131209", padding: 24 } as const;
const H3 = { margin: 0, fontSize: 16, fontWeight: 500 } as const;
const PHONES: { id: CameraId; x: string; y: string; rot: string }[] = [
  { id: "A", x: "50%", y: "91%", rot: "0deg" },
  { id: "B", x: "7%", y: "50%", rot: "0deg" },
  { id: "C", x: "91%", y: "10%", rot: "0deg" },
  { id: "D", x: "9%", y: "10%", rot: "-72deg" },
];

export function CaptureView({ manifest, claims }: { manifest: SceneManifest; claims: Claim[] }) {
  const site = useSite();
  const { sync, syncing, split, run, running, startSync, startSplit, startRun } = site;
  const syncRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ sync, syncing });
  live.current = { sync, syncing };
  useEffect(() => {
    site.splitTotal.current = splitTotal(claims);
  }, [claims, site.splitTotal]);
  useCanvasLoop(syncRef, (ctx, w, h, time) => drawSync(ctx, w, h, live.current.sync, live.current.syncing, time));

  const synced = sync >= 1;
  const total = splitTotal(claims);
  const steps = [
    { label: "Sync", done: synced },
    { label: "Claims", done: total > 0 && split >= total - 6 },
    { label: "Pipeline", done: run >= 6 },
  ];
  const excluded = new Set(manifest.excludedCameras);
  const phoneColor = (id: CameraId) => (excluded.has(id) ? "#7D838C" : synced ? "#7CC7FF" : "#ECE6DA");
  const typed = splitClaims(claims, split);
  const actor = claims[0]?.actor ?? "Actor";

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "100px clamp(16px,3vw,40px) 80px", maxWidth: 1320, margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 32 }}>
        <div>
          <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#7D838C" }}>
            SCENE {manifest.sceneId === "demo-001" ? "01" : manifest.sceneId} · {(manifest.room || "—").toUpperCase()} · {manifest.durationS}s
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }}>
            Capture <span style={{ fontWeight: 400, color: "#9AA0A8" }}>&amp; sync</span>
          </h1>
        </div>
        <div className="rs-mono" style={{ display: "flex", gap: 6, fontSize: 12 }}>
          {steps.map((s) => (
            <span key={s.label} style={{ padding: "6px 12px", borderRadius: 999, border: `1px solid ${s.done ? "rgba(91,228,155,0.4)" : "rgba(236,230,218,0.14)"}`, color: s.done ? "#5BE49B" : "#9AA0A8", transition: "color .3s, border-color .3s" }}>
              {s.done ? "✓ " : ""}
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 16 }}>
        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3 style={H3}>The rig</h3>
            <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>{manifest.cameras.length} phones · mat zones A–F</span>
          </div>
          <div style={{ position: "relative", height: 340, marginTop: 16 }}>
            <div style={{ position: "absolute", left: "18%", right: "18%", top: "20%", bottom: "20%", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gridTemplateRows: "repeat(2,1fr)", border: "1px solid rgba(236,230,218,0.3)", borderRadius: 6, overflow: "hidden", background: "repeating-linear-gradient(45deg,rgba(236,230,218,0.015) 0 6px,rgba(236,230,218,0.04) 6px 7px)" }}>
              {["A", "B", "C", "D", "E", "F"].map((z) => (
                <div key={z} className="rs-mono" style={{ border: "1px solid rgba(236,230,218,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#5E646D" }}>
                  {z}
                </div>
              ))}
            </div>
            {PHONES.map((p) => {
              const c = phoneColor(p.id);
              const glow = excluded.has(p.id) ? "rgba(0,0,0,0)" : synced ? "rgba(124,199,255,0.35)" : "rgba(236,230,218,0.12)";
              return (
                <div key={p.id} style={{ position: "absolute", left: p.x, top: p.y, transform: `translate(-50%,-50%) rotate(${p.rot})`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 30, height: 50, borderRadius: 7, border: `1.5px solid ${c}`, background: "#1F1F1F", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 5, boxSizing: "border-box", boxShadow: `0 0 22px ${glow}`, transition: "border-color .5s, box-shadow .5s" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />
                  </div>
                  <span className="rs-mono" style={{ fontSize: 12, color: c, whiteSpace: "nowrap" }}>CAM {p.id}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 8 }}>
            {PHONES.map((p) => (
              <div key={p.id} style={{ fontSize: 13, color: "#8A9099", lineHeight: 1.4 }}>
                <span className="rs-mono" style={{ color: phoneColor(p.id) }}>{p.id}</span> {VIEWS[p.id]}
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3 style={H3}>Sync on clap + flash</h3>
            <button type="button" onClick={startSync} className="rs-btn rs-btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
              {syncing ? "Syncing…" : synced ? "Re-sync" : "Sync"}
            </button>
          </div>
          <canvas ref={syncRef} role="img" aria-label="Waveforms of the four cameras lining up on the clap" style={{ width: "100%", height: 240, display: "block", marginTop: 16, borderRadius: 12, background: "#000" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, marginTop: 16 }}>
            {(["A", "B", "C", "D"] as CameraId[]).map((c) => {
              const off = excluded.has(c);
              return (
                <div key={c} style={{ border: "1px solid rgba(236,230,218,0.08)", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
                  <div className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>CAM {c}</div>
                  <div className="rs-mono" style={{ fontSize: 14, marginTop: 4, color: off ? "#7D838C" : synced ? "#7CC7FF" : "#ECE6DA" }}>{offsetText(SYNC_OFFSETS[c], sync)}</div>
                  <div style={{ fontSize: 12, color: "#7D838C", marginTop: 2 }}>{off ? "fell over · excluded" : synced ? "synced" : "waiting"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: 16, marginTop: 16 }}>
        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={H3}>Spoken account</h3>
            <button type="button" onClick={startSplit} className="rs-btn rs-btn-line" style={{ padding: "8px 16px", fontSize: 12, fontWeight: 500 }}>
              Split into claims · gemini-4-carbon
            </button>
          </div>
          <blockquote style={{ margin: "16px 0 0", fontSize: 24, lineHeight: 1.4, color: "#C9C2B4", padding: "18px 20px", borderLeft: "2px solid rgba(236,230,218,0.2)", background: "rgba(236,230,218,0.02)", borderRadius: "0 12px 12px 0" }}>
            &ldquo;{accountText(claims)}&rdquo; <span style={{ fontSize: 12, color: "#7D838C" }}>— {actor}</span>
          </blockquote>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            {typed.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "10px 14px", border: "1px solid rgba(236,230,218,0.08)", borderRadius: 10, background: "#181818" }}>
                <span className="rs-mono" style={{ fontSize: 12, color: "#7CC7FF" }}>{c.id}</span>
                <span style={{ fontSize: 14 }}>{c.text}</span>
                <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>{c.win}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3 style={H3}>Pipeline</h3>
            <button type="button" onClick={startRun} className="rs-btn rs-btn-primary" style={{ padding: "8px 16px", fontSize: 12 }}>
              {running ? "Running…" : run >= 6 ? "Run again" : "Run pipeline"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20, flex: 1 }}>
            {STAGES.map(([label, model], i) => {
              const p = stageProgress(run, i);
              const color = p >= 1 ? "#ECE6DA" : p > 0 ? "#7CC7FF" : "#7D838C";
              return (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                    <span style={{ color }}>{p >= 1 ? "✓" : p > 0 ? "◌" : "·"} {label}</span>
                    <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C", whiteSpace: "nowrap" }}>{model}</span>
                  </div>
                  <div style={{ marginTop: 7, height: 3, borderRadius: 3, background: "rgba(236,230,218,0.07)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: pct(p), background: "linear-gradient(90deg,#7CC7FF,#ECE6DA)", boxShadow: "0 0 12px #7CC7FF" }} />
                  </div>
                </div>
              );
            })}
          </div>
          {run >= 6 && (
            <Link href="/board" className="rs-btn rs-done-btn" style={{ marginTop: 20, background: "#5BE49B", color: "#060709", borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 600, textAlign: "center" }}>
              {claims.length} claims labeled · open the board →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
