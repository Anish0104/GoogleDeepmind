// OWNER: Dev 4. Proof for one claim: the label stamp, a clip player per evidence row,
// per-camera evidence bars against the thresholds, the full label history (including
// blocked Skeptic attempts, the safety story) and the audit scores.
"use client";

import Link from "next/link";
import { useState } from "react";
import { THRESHOLDS } from "@/lib/config";
import type { Claim, ClaimResult } from "@/lib/types";
import { pct, winTxt } from "@/components/canvas/math";
import { AGENT_COLOR, SOURCE_COLOR, verdictStyle } from "@/components/verdictStyle";
import { ClipPlayer } from "./ClipPlayer";
import { clockTime } from "./format";

const CARD = { border: "1px solid rgba(236,230,218,0.09)", borderRadius: 18, background: "#131209", padding: 22 } as const;

function Bar({ name, value, color, threshold }: { name: string; value: number | null; color: string; threshold: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "86px minmax(0,1fr) 44px", gap: 10, alignItems: "center", marginTop: 9 }}>
      <span style={{ fontSize: 13, color: "#8A9099" }}>{name}</span>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(236,230,218,0.06)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: value == null ? "0%" : pct(value), borderRadius: 4, background: color, boxShadow: `0 0 12px ${color}`, transition: "width .8s cubic-bezier(.2,.8,.2,1)" }} />
        <div title={`threshold ${threshold.toFixed(2)}`} style={{ position: "absolute", left: pct(threshold), top: -4, bottom: -4, width: 1, background: "#ECE6DA", opacity: 0.6 }} />
      </div>
      <span className="rs-mono" style={{ fontSize: 12, textAlign: "right" }}>{value == null ? "—" : value.toFixed(2)}</span>
    </div>
  );
}

export function ProofView({
  sceneId,
  claims,
  results,
  claimId,
  initialClip = 0,
  sceneQuery = "",
}: {
  sceneId: string;
  claims: Claim[];
  results: ClaimResult[];
  claimId: string;
  initialClip?: number;
  sceneQuery?: string;
}) {
  const claim = claims.find((c) => c.id === claimId);
  const result = results.find((r) => r.claimId === claimId);
  const [clip, setClip] = useState(initialClip);

  const tabs = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
      {claims.map((c) => {
        const r = results.find((x) => x.claimId === c.id);
        const v = r ? verdictStyle(r.verdict) : null;
        const on = c.id === claimId;
        return (
          <Link
            key={c.id}
            href={`/proof/${encodeURIComponent(c.id)}${sceneQuery}`}
            aria-current={on ? "page" : undefined}
            className="rs-mono rs-hover-border"
            style={{ display: "flex", alignItems: "center", gap: 8, background: on && v ? v.bg : "transparent", border: `1px solid ${on && v ? v.border : "rgba(236,230,218,0.12)"}`, color: "#ECE6DA", borderRadius: 999, padding: "8px 14px", fontSize: 12 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: v?.color ?? "#7D838C" }} />
            {c.id} · {c.object}
          </Link>
        );
      })}
    </div>
  );

  if (!claim) {
    return (
      <main style={{ position: "relative", zIndex: 2, padding: "88px clamp(16px,3vw,40px) 80px", maxWidth: 1400, margin: "0 auto" }}>
        {tabs}
        <p style={{ color: "#9AA0A8" }}>No claim {claimId} in scene {sceneId}.</p>
      </main>
    );
  }

  const v = result ? verdictStyle(result.verdict) : null;
  const evidence = result?.evidence ?? [];

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "88px clamp(16px,3vw,40px) 80px", maxWidth: 1400, margin: "0 auto", boxSizing: "border-box" }}>
      {tabs}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,520px),1fr))", gap: 24, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: "#7D838C" }}>
            {[claim.id, claim.actor, claim.action, claim.object, winTxt(claim.window)].join(" · ")}
            {claim.timeIsPrecise ? "" : " · approx"}
          </div>
          <h1 style={{ margin: "14px 0 0", fontWeight: 400, fontSize: "clamp(40px,4.6vw,68px)", lineHeight: 1.04, letterSpacing: "-0.015em", textWrap: "balance" }}>
            &ldquo;{claim.text}&rdquo;
          </h1>
          {v && result && (
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 28, flexWrap: "wrap" }}>
              <div
                key={claim.id}
                className="rs-mono"
                style={{ padding: "12px 22px", border: `2.5px solid ${v.color}`, color: v.color, fontWeight: 600, fontSize: 20, letterSpacing: "0.16em", textTransform: "uppercase", borderRadius: 6, animation: "rsStamp .45s cubic-bezier(.2,.9,.3,1.2) both", boxShadow: `0 0 40px ${v.glow}, inset 0 0 20px ${v.glow}` }}
              >
                {v.mark} {result.verdict}
              </div>
              <div style={{ fontSize: 14, color: "#9AA0A8", maxWidth: 360, lineHeight: 1.5 }}>{v.long}</div>
            </div>
          )}
          <ClipPlayer sceneId={claim.sceneId} evidence={evidence} selected={Math.min(clip, Math.max(0, evidence.length - 1))} onSelect={setClip} />
        </div>

        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Per camera evidence</h2>
              <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>
                usable ≥ {THRESHOLDS.USABLE.toFixed(2)} · clear ≥ {THRESHOLDS.CLEAR.toFixed(2)} · decisive ≥ {THRESHOLDS.DECISIVE.toFixed(2)}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 20 }}>
              {evidence.length === 0 && <p style={{ margin: 0, fontSize: 13, color: "#7D838C" }}>No evidence rows.</p>}
              {evidence.map((e, i) => (
                <div key={i}>
                  <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span>CAM {e.camera} · {winTxt(e.window)}</span>
                    <span style={{ color: SOURCE_COLOR[e.source] }}>{e.source}</span>
                  </div>
                  <Bar name="visible" value={e.visible} color="#ECE6DA" threshold={THRESHOLDS.USABLE} />
                  <Bar name="supports" value={e.supports} color="#5BE49B" threshold={THRESHOLDS.CLEAR} />
                  <Bar name="contradicts" value={e.contradicts} color="#FF5A47" threshold={THRESHOLDS.DECISIVE} />
                </div>
              ))}
            </div>
          </div>

          <div style={CARD}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Label history</h2>
            <ol style={{ listStyle: "none", margin: "18px 0 0", padding: "0 0 0 18px", borderLeft: "1px solid rgba(236,230,218,0.12)", display: "flex", flexDirection: "column", gap: 18 }}>
              {(result?.history ?? []).map((h, i) => (
                <li key={i} style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: -23, top: 4, width: 9, height: 9, borderRadius: "50%", background: "#000", border: `1.5px solid ${AGENT_COLOR[h.by]}` }} />
                  <div className="rs-mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ color: AGENT_COLOR[h.by] }}>{h.by}</span>
                    <span style={{ color: "#5E646D" }}>{clockTime(h.at)}</span>
                  </div>
                  <div className="rs-mono" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6, fontSize: 14 }}>
                    <span style={{ color: verdictStyle(h.from).color }}>{h.from}</span>
                    <span style={{ color: "#5E646D" }}>→</span>
                    <span style={{ color: verdictStyle(h.to).color, textDecoration: h.blocked ? "line-through" : "none" }}>{h.to}</span>
                    {h.blocked && (
                      <span style={{ padding: "2px 8px", border: "1.5px solid #FF5A47", color: "#FF5A47", fontSize: 10, letterSpacing: "0.18em", borderRadius: 3, transform: "rotate(-4deg)" }}>BLOCKED</span>
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: "#A9AEB5" }}>{h.reason}</div>
                </li>
              ))}
            </ol>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 16 }}>
            {[
              { label: "Audit · support", value: result?.audit?.supportScore, color: "#5BE49B" },
              { label: "Audit · contradict", value: result?.audit?.contradictScore, color: "#FF5A47" },
            ].map((a) => (
              <div key={a.label} style={{ ...CARD, padding: 20 }}>
                <div style={{ fontSize: 13, color: "#8A9099" }}>{a.label}</div>
                <div className="rs-mono" style={{ marginTop: 8, fontSize: 32, color: a.color }}>{a.value == null ? "—" : a.value.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
