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
import { useTheme } from "@/components/site/ThemeContext";
import { verdictStyle } from "@/components/verdictStyle";
import { hudFrame } from "./hud";

function HudCard({ sceneId, claims, results }: { sceneId: string; claims: Claim[]; results: ClaimResult[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
        width: 360,
        background: isDark ? "rgba(15,17,23,0.72)" : "rgba(255,255,255,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.08)"}`,
        borderRadius: 20,
        padding: "20px 22px",
        boxShadow: isDark
          ? "0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)"
          : "0 20px 48px -8px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,1)",
        transition: "all 0.4s ease",
      }}
    >
      <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, letterSpacing: "0.08em", color: isDark ? "#64748B" : "#475569" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
          <span style={{ color: isDark ? "#10B981" : "#059669", fontWeight: 600 }}>LIVE SYNC</span> · {sceneId} · {claim.id}
        </span>
        <span style={{ color: isDark ? "#94A3B8" : "#475569" }}>{winTxt(claim.window)}</span>
      </div>
      <div className="rs-serif" style={{ marginTop: 14, minHeight: 68, fontSize: 22, lineHeight: 1.35, color: isDark ? "#FAF8F5" : "#0A0C10", fontStyle: "italic", transition: "color 0.4s ease" }}>
        &ldquo;{typed}&rdquo;
        {typed.length < claim.text.length && <span className="rs-caret" />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
        {result.evidence.map((e, i) => (
          <div key={i} className="rs-mono" style={{ fontSize: 11, color: isDark ? "#94A3B8" : "#475569" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>CAM {e.camera}</span>
              <span style={{ color: isDark ? "#FAF8F5" : "#0A0C10" }}>vis {e.visible.toFixed(2)}</span>
            </div>
            <div style={{ marginTop: 5, height: 3, background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: f.bars ? pct(e.visible) : "0%", background: "#10B981", transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ height: 40, marginTop: 14, display: "flex", alignItems: "center" }}>
        {f.stamped ? (
          <div
            key={`${claim.id}-${Math.floor(tick / 125)}`}
            className="rs-mono"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 16px", border: `1.5px solid ${v.color}`, color: v.color, borderRadius: 999, fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", animation: "rsStamp .45s cubic-bezier(.2,.9,.3,1.2) both", boxShadow: `0 0 24px ${v.glow}` }}
          >
            {v.mark} {result.verdict}
          </div>
        ) : (
          <div className="rs-mono" style={{ fontSize: 11, color: isDark ? "#64748B" : "#475569", letterSpacing: "0.08em" }}>
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
      theme: theme,
    });
  });

  return (
    <section style={{ position: "relative", height: "100vh", minHeight: 720, overflow: "hidden" }}>
      <canvas ref={ref} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: isDark
            ? "linear-gradient(90deg,rgba(0,0,0,0.96) 0%,rgba(0,0,0,0.65) 36%,rgba(0,0,0,0) 65%)"
            : "linear-gradient(90deg,rgba(245,245,247,0.96) 0%,rgba(245,245,247,0.72) 38%,rgba(245,245,247,0) 65%)",
          pointerEvents: "none",
          transition: "background 0.4s ease",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 220,
          background: isDark
            ? "linear-gradient(0deg,#000000,rgba(0,0,0,0))"
            : "linear-gradient(0deg,#F5F5F7,rgba(245,245,247,0))",
          pointerEvents: "none",
          transition: "background 0.4s ease",
        }}
      />
      <div style={{ position: "relative", zIndex: 2, height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 clamp(20px,5vw,72px) clamp(56px,10vh,110px)", maxWidth: 960 }}>
        <div style={{ marginBottom: 24 }}>
          <span
            className="rs-mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 16px",
              borderRadius: 999,
              background: isDark ? "rgba(48, 209, 88, 0.08)" : "rgba(48, 209, 88, 0.12)",
              border: `1px solid ${isDark ? "rgba(48, 209, 88, 0.22)" : "rgba(48, 209, 88, 0.28)"}`,
              color: isDark ? "#30D158" : "#248A3D",
              fontSize: 11,
              letterSpacing: "0.14em",
              fontWeight: 600,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#30D158", boxShadow: "0 0 10px #30D158", flex: "none" }} />
            PHYSICAL GROUND TRUTH · MULTI-CAMERA CONSENSUS
          </span>
        </div>
        <h1
          className="rs-serif"
          style={{
            margin: 0,
            maxWidth: 780,
            fontWeight: 400,
            fontSize: "clamp(46px,6.8vw,92px)",
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            textWrap: "balance",
            color: isDark ? "#FAF8F5" : "#0A0C10",
            transition: "color 0.4s ease",
          }}
        >
          Don&rsquo;t just recount what happened.
          <br />
          <span
            style={{
              fontStyle: "italic",
              fontWeight: 400,
              color: isDark ? "#34D399" : "#059669",
            }}
          >
            Let the cameras prove it.
          </span>
        </h1>
        <p style={{ margin: "26px 0 0", maxWidth: 660, fontSize: 17, lineHeight: "28px", color: isDark ? "#94A3B8" : "#475569", textWrap: "pretty", transition: "color 0.4s ease" }}>
          Multiple phones film one event. Our perceptual reasoning system checks each claim in a person&rsquo;s spoken account against synchronized footage and labels it{" "}
          <span style={{ color: "#10B981", fontWeight: 600 }}>Supported</span>, <span style={{ color: "#F43F5E", fontWeight: 600 }}>Contradicted by visible evidence</span>, or{" "}
          <span style={{ color: "#F59E0B", fontWeight: 600 }}>Insufficient footage</span>. It labels claims, never people.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 34 }}>
          <Link
            href="/new"
            className="rs-btn rs-btn-primary rs-glow-btn"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 28px", fontSize: 14, fontWeight: 600 }}
          >
            <span aria-hidden style={{ fontSize: 18, lineHeight: "16px" }}>+</span>
            New investigation
          </Link>
          <Link
            href="/board"
            className="rs-btn rs-btn-ghost"
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 28px", fontSize: 14, fontWeight: 500 }}
          >
            Watch the demo →
          </Link>
        </div>
      </div>
      <HudCard sceneId={sceneId} claims={claims} results={results} />
      <div className="rs-mono" style={{ position: "absolute", zIndex: 3, left: "50%", bottom: 22, transform: "translateX(-50%)", fontSize: 10, letterSpacing: "0.3em", color: isDark ? "#475569" : "#94A3B8" }}>
        SCROLL
      </div>
    </section>
  );
}
