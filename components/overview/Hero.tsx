// OWNER: Dev 4. Landing hero: the full-bleed canvas, headline, CTAs and the live HUD card
// that types each demo claim, fills its evidence bars and stamps its label.
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Claim, ClaimResult } from "@/lib/types";
import { type HeroVariant, drawHero, makeHeroState } from "@/components/canvas/drawHero";
import { pct, winTxt } from "@/components/canvas/math";
import { useSite } from "@/components/site/SiteStore";
import { useCanvasLoop } from "@/components/site/useCanvasLoop";
import { verdictStyle } from "@/components/verdictStyle";
import { hudFrame } from "./hud";

function HudCard({ sceneId, claims, results }: { sceneId: string; claims: Claim[]; results: ClaimResult[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(Math.floor(performance.now() / 40)), 40);
    return () => clearInterval(id);
  }, []);
  const f = hudFrame(tick, claims.length);
  const claim = claims[f.index];
  const result = claim ? results.find((r) => r.claimId === claim.id) : undefined;
  if (!claim || !result) return null;
  const v = verdictStyle(result.verdict);
  const typed = claim.text.slice(0, f.chars);
  return (
    <div
      className="hidden min-[1100px]:block"
      style={{
        position: "absolute",
        zIndex: 3,
        right: "clamp(20px,4vw,64px)",
        bottom: "clamp(56px,10vh,110px)",
        width: 340,
        background: "rgba(10,12,16,0.62)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(236,230,218,0.1)",
        borderRadius: 16,
        padding: "18px 20px",
        boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
      }}
    >
      <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, letterSpacing: "0.08em", color: "#7D838C" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF5A47" }} />
          LIVE · {sceneId} · {claim.id}
        </span>
        <span>{winTxt(claim.window)}</span>
      </div>
      <div style={{ marginTop: 14, minHeight: 64, fontSize: 24, lineHeight: 1.2, color: "#ECE6DA" }}>
        &ldquo;{typed}
        {typed.length < claim.text.length && <span className="rs-caret" />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
        {result.evidence.map((e, i) => (
          <div key={i} className="rs-mono" style={{ fontSize: 12, color: "#9AA0A8" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>CAM {e.camera}</span>
              <span>vis {e.visible.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 5, height: 3, background: "rgba(236,230,218,0.08)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: f.bars ? pct(e.visible) : "0%", background: "#ECE6DA", transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 40, marginTop: 14, display: "flex", alignItems: "center" }}>
        {f.stamped ? (
          <div
            key={`${claim.id}-${Math.floor(tick / 125)}`}
            className="rs-mono"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", border: `1.5px solid ${v.color}`, color: v.color, borderRadius: 6, fontSize: 13, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", animation: "rsStamp .45s cubic-bezier(.2,.9,.3,1.2) both", boxShadow: `0 0 24px ${v.glow}` }}
          >
            {v.mark} {result.verdict}
          </div>
        ) : (
          <div className="rs-mono" style={{ fontSize: 12, color: "#7D838C", letterSpacing: "0.08em" }}>
            checking {result.evidence.length > 1 ? `${result.evidence.length} angles` : "the angles"}…
          </div>
        )}
      </div>
    </div>
  );
}

export function Hero({
  variant = "Convergence",
  sceneId,
  claims,
  results,
}: {
  variant?: HeroVariant;
  sceneId: string;
  claims: Claim[];
  results: ClaimResult[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { pointer } = useSite();
  const state = useMemo(() => makeHeroState(), []);
  useCanvasLoop(ref, (ctx, w, h, time) => {
    const p = pointer.current;
    const r = ref.current?.getBoundingClientRect();
    drawHero(ctx, w, h, time, variant, state, {
      mx: p.mxs,
      my: p.mys,
      cx: r ? p.x - r.left : -9999,
      cy: r ? p.y - r.top : -9999,
      scrollY: window.scrollY || 0,
    });
  });

  return (
    <section style={{ position: "relative", height: "100vh", minHeight: 720, overflow: "hidden" }}>
      <canvas ref={ref} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,rgba(6,7,9,0.94) 0%,rgba(6,7,9,0.6) 34%,rgba(6,7,9,0) 62%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 220, background: "linear-gradient(0deg,#060709,rgba(6,7,9,0))", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 2, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 clamp(20px,5vw,72px) clamp(56px,10vh,110px)", maxWidth: 900 }}>
        <div className="rs-mono" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, fontSize: 12, letterSpacing: "0.14em", color: "#9AA0A8" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF5A47", boxShadow: "0 0 12px #FF5A47", flex: "none" }} />
          GEMINI 4 NYC HACKATHON · ELEMENT 119
        </div>
        <h1
          style={{
            margin: 0,
            maxWidth: 680,
            fontWeight: 600,
            fontSize: "clamp(48px,7vw,96px)",
            lineHeight: 1,
            letterSpacing: "-0.04em",
            textWrap: "balance",
            background: "linear-gradient(90deg,#FFFFFF,#9B9B9B)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Four cameras.
          <br />
          One event.
          <br />
          Every claim checked.
        </h1>
        <p style={{ margin: "32px 0 0", maxWidth: 680, fontSize: 18, lineHeight: "28px", color: "#A9AEB5", textWrap: "pretty" }}>
          Several phones film one event. RASHOMON checks each claim in a person&rsquo;s spoken account against the footage and labels it{" "}
          <span style={{ color: "#5BE49B" }}>Supported</span>, <span style={{ color: "#FF5A47" }}>Contradicted by visible evidence</span>, or{" "}
          <span style={{ color: "#FFC23D" }}>Insufficient footage</span>. It labels claims, never people.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36 }}>
          <Link
            href="/new"
            className="rs-btn rs-btn-primary rs-glow-btn"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 26px", fontSize: 15 }}
          >
            <span aria-hidden style={{ fontSize: 18, lineHeight: "16px" }}>+</span>
            New investigation
          </Link>
          <Link
            href="/board"
            className="rs-btn rs-btn-ghost"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 26px", fontSize: 15, fontWeight: 500, color: "#ECE6DA" }}
          >
            Watch the demo →
          </Link>
        </div>
      </div>
      <HudCard sceneId={sceneId} claims={claims} results={results} />
      <div className="rs-mono" style={{ position: "absolute", zIndex: 3, left: "50%", bottom: 22, transform: "translateX(-50%)", fontSize: 10, letterSpacing: "0.3em", color: "#5E646D" }}>
        SCROLL
      </div>
    </section>
  );
}
