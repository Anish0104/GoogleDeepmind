// OWNER: Dev 4. The board: the live demo screen. Presentation over a ReplayScene, so the
// same component renders a live scene or a saved replay. One replay clock (from SiteStore)
// drives the camera tiles, the evidence grid, the claim labels and the agent trace.
"use client";

import { useEffect, useMemo } from "react";
import type { ReplayScene } from "./loadScene";
import { CameraGrid } from "./CameraGrid";
import { ClaimRow } from "./ClaimRow";
import { AgentTrace } from "./AgentTrace";
import { CostMeter } from "./CostMeter";
import { Grid } from "./Grid";
import { ScenePicker } from "./ScenePicker";
import { Transport } from "./Transport";
import { buildTimeline, noteAt, spentAt, stepsShown, verdictAt } from "./replay/timeline";
import { useSite } from "./site/SiteStore";
import { VERDICT_STYLE } from "./verdictStyle";
import type { Verdict } from "@/lib/types";

const VERDICTS: Verdict[] = ["Supported", "Contradicted", "Insufficient"];

/** Link to a claim's Proof page, keeping a non-default scene. */
export function proofHref(claimId: string, sceneDir?: string, defaultDir?: string): string {
  const base = `/proof/${encodeURIComponent(claimId)}`;
  return sceneDir && sceneDir !== defaultDir ? `${base}?scene=${encodeURIComponent(sceneDir)}` : base;
}

export function Board({
  scene,
  scenes = [],
  sceneDir,
  defaultDir,
}: {
  scene: ReplayScene;
  scenes?: string[];
  sceneDir?: string;
  defaultDir?: string;
}) {
  const { manifest, claims, results, grid, agentSteps, questions } = scene;
  const site = useSite();
  const { T, tRef, playing, excluded, setExcluded, setTimeline, setBounds, sceneKey, setPlaying, autoplayBoard, togglePlay } = site;

  const timeline = useMemo(
    () => buildTimeline(claims, results, agentSteps, manifest.durationS),
    [claims, results, agentSteps, manifest.durationS],
  );

  useEffect(() => {
    setTimeline(timeline);
    setBounds(timeline.foot, timeline.end);
    const key = sceneDir ?? scene.dir;
    if (sceneKey.current !== key) {
      sceneKey.current = key;
      setExcluded(manifest.excludedCameras);
    }
    if (autoplayBoard && tRef.current <= 0.01) setPlaying(true);
    // run on scene change only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, sceneDir]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "A") return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const current = new Map(claims.map((c) => [c.id, verdictAt(timeline, c.id, T)]));
  const shown = stepsShown(timeline, T);
  const spent = spentAt(timeline, T);
  const exclLabel = excluded.length ? `${excluded.map((x) => `CAM ${x}`).join(", ")} excluded` : "all cameras in";

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "88px clamp(16px,3vw,40px) 60px", maxWidth: 1480, margin: "0 auto", boxSizing: "border-box" }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 20, paddingBottom: 20, borderBottom: "1px solid var(--border-card)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 className="rs-serif" style={{ margin: 0, fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em", color: "var(--text-ink)" }}>{manifest.sceneId}</h1>
            {manifest.plannedOcclusion && (
              <span className="rs-mono" style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, border: "1px solid rgba(251,191,36,0.35)", background: "rgba(251,191,36,0.08)", color: "#FBBF24" }}>
                planned occlusion
              </span>
            )}
          </div>
          <div className="rs-mono" style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
            {[manifest.room || "—", manifest.split, `${manifest.durationS}s`, `${manifest.cameras.length} cameras`, exclLabel].join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
          {sceneDir && <ScenePicker scenes={scenes} current={sceneDir} />}
          <div className="rs-mono" style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap" }}>
            {VERDICTS.map((v) => {
              const n = claims.filter((c) => current.get(c.id) === v).length;
              const color = VERDICT_STYLE[v].color;
              return (
                <span key={v} style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-body)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 10px ${color}` }} />
                  {n} {v}
                </span>
              );
            })}
          </div>
          <CostMeter spentUsd={spent} />
        </div>
      </header>

      <div className="rs-board-grid" style={{ display: "grid", gap: 20, marginTop: 20, alignItems: "start" }}>
        <section style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <CameraGrid
            cameras={manifest.cameras}
            excluded={excluded}
            setExcluded={setExcluded}
            T={T}
            tRef={tRef}
            timeline={timeline}
          />
          <Transport
            T={T}
            playing={playing}
            timeline={timeline}
            claims={claims}
            results={results}
            togglePlay={togglePlay}
            restart={site.restart}
            seek={site.seek}
          />
          <Grid
            grid={grid}
            cameras={manifest.cameras}
            questions={questions}
            claims={claims}
            excluded={excluded}
            foot={timeline.foot}
            tRef={tRef}
          />
        </section>

        <aside style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="rs-card" style={{ borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Claims</h2>
              <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>
                {[...new Set(claims.map((c) => c.actor))].join(", ")}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {claims.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "#7D838C" }}>No claims in this scene yet.</p>}
              {claims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  verdict={current.get(claim.id) ?? null}
                  note={noteAt(timeline, claim.id, T)}
                  T={T}
                  href={proofHref(claim.id, sceneDir, defaultDir)}
                />
              ))}
            </div>
          </div>
          <AgentTrace steps={timeline.steps} shown={shown} T={T} end={timeline.end} />
        </aside>
      </div>
    </main>
  );
}
