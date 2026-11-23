// OWNER: Dev 4. The landing page: hero, how a claim gets its label, the tagline, the three
// labels, the agent safety story, privacy and the call to action.
"use client";

import Link from "next/link";
import { useRef } from "react";
import type { Claim, ClaimResult, Verdict } from "@/lib/types";
import type { HeroVariant } from "@/components/canvas/drawHero";
import { useReveal } from "@/components/site/useReveal";
import { useTheme } from "@/components/site/ThemeContext";
import { VERDICT_STYLE } from "@/components/verdictStyle";
import { Hero } from "./Hero";
import { exampleFor } from "./hud";

const SECTION = { position: "relative", zIndex: 2, margin: "0 auto" } as const;
const H2 = { margin: 0, fontWeight: 400, fontSize: "clamp(42px,5.4vw,80px)", lineHeight: 1.02, letterSpacing: "-0.025em" } as const;

const HOW = [
  { n: "01", color: "#2997FF", title: "Capture & sync", body: "Synchronized recording across multiple viewpoints; an acoustic impulse and optical pulse align camera streams to sub-frame precision.", chips: ["sub-frame sync", "≤ 4 s clips"] },
  { n: "02", color: "#30D158", title: "Evidence synthesis", body: "High-resolution spatial feature extractors map critical entities and physical states; calibrated probabilistic reasoning evaluates every camera angle and slice.", chips: ["spatial-lattice", "calibrated-prob"] },
  { n: "03", color: "#34D399", title: "Grounded labels", body: "Deterministic physical rules evaluate cross-camera evidence into mathematical labels. Contradicted requires absolute consensus across unoccluded viewpoints.", chips: ["verdict()", "temporal-grounding"] },
  { n: "04", color: "#BF5AF2", title: "Autonomous agents", body: "Dedicated reasoning agents inspect edge clips. The Investigator settles undecided moments; the Skeptic audits falsifying viewpoints to challenge preliminary consensus.", chips: ["Investigator", "Skeptic"] },
];

const TILES: { v: Verdict; name: string; rule: string }[] = [
  { v: "Supported", name: "Supported", rule: "All usable cameras (visibility ≥ 0.60) reach consensus and the affirmative support score clears 0.80." },
  { v: "Contradicted", name: "Contradicted by footage", rule: "The contradict score reaches 0.90 across unoccluded viewpoints. The most rigorous label to attain." },
  { v: "Insufficient", name: "Insufficient footage", rule: "Key occlusions obscure the critical moment, or camera evidence clears neither threshold." },
];

const TAGLINE = "Many angles on one moment. Each claim gets the label the footage mathematically proves, and never a verdict on the person.";

export function Overview({
  variant,
  sceneId,
  claims,
  results,
}: {
  variant?: HeroVariant;
  sceneId: string;
  claims: Claim[];
  results: ClaimResult[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  useReveal(root);

  return (
    <div ref={root}>
      <Hero variant={variant} sceneId={sceneId} claims={claims} results={results} />

      <section style={{ ...SECTION, padding: "clamp(80px,14vh,160px) clamp(20px,5vw,72px)", maxWidth: 1320 }}>
        <div data-reveal="" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginBottom: 64 }}>
          <div>
            <span className="rs-mono" style={{ display: "inline-block", fontSize: 11, letterSpacing: "0.14em", color: "#10B981", marginBottom: 16, fontWeight: 500 }}>
              VERIFICATION ARCHITECTURE
            </span>
            <h2 className="rs-serif" style={{ ...H2, maxWidth: 760, color: isDark ? "#FAF8F5" : "#0A0C10" }}>How a claim gets its label</h2>
          </div>
          <p style={{ margin: 0, maxWidth: 360, color: isDark ? "#94A3B8" : "#475569", fontSize: 15, lineHeight: 1.6 }}>
            Four stages, four owners, one contract in <span className="rs-mono" style={{ color: "#10B981" }}>lib/types.ts</span>.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 16 }}>
          {HOW.map((s) => (
            <div
              key={s.n}
              data-reveal=""
              className="rs-hover-raise rs-card"
              style={{
                borderRadius: 24,
                padding: "32px 28px 36px",
                display: "flex",
                flexDirection: "column",
                gap: 18,
                minHeight: 340,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="rs-mono" style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.n}</span>
                <span style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, boxShadow: `0 0 12px ${s.color}` }} />
                </span>
              </div>
              <h3 className="rs-serif" style={{ margin: "20px 0 0", fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: isDark ? "#FAF8F5" : "#0A0C10" }}>{s.title}</h3>
              <p style={{ margin: 0, color: isDark ? "#94A3B8" : "#475569", fontSize: 15, lineHeight: 1.6, textWrap: "pretty", flex: 1 }}>{s.body}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {s.chips.map((c) => (
                  <span key={c} className="rs-mono" style={{ fontSize: 11, color: isDark ? "#E2E8F0" : "#334155", border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`, background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)", borderRadius: 999, padding: "4px 10px" }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...SECTION, padding: "96px clamp(20px,5vw,72px)", display: "flex", justifyContent: "center" }}>
        <p className="rs-serif" style={{ margin: 0, maxWidth: 740, fontSize: "clamp(34px,4.8vw,58px)", lineHeight: 1.2, fontWeight: 400, letterSpacing: "-0.02em", display: "flex", flexWrap: "wrap", columnGap: "0.26em", rowGap: 10 }}>
          {TAGLINE.split(" ").map((w, i) => (
            <span key={i} data-word="" style={{ color: isDark ? "#FAF8F5" : "#0A0C10", opacity: 0.28, transition: "opacity .6s cubic-bezier(.22,1,.36,1)" }}>
              {w}
            </span>
          ))}
        </p>
      </section>

      <section style={{ ...SECTION, padding: "clamp(40px,8vh,100px) clamp(20px,5vw,72px)", maxWidth: 1320 }}>
        <div style={{ marginBottom: 56 }}>
          <span className="rs-mono" style={{ display: "inline-block", fontSize: 11, letterSpacing: "0.14em", color: "#10B981", marginBottom: 16, fontWeight: 500 }}>
            EVIDENCE TAXONOMY
          </span>
          <h2 className="rs-serif" data-reveal="" style={{ ...H2, maxWidth: 900, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
            Three labels. <span style={{ color: "#64748B", fontStyle: "italic" }}>None of them about a person.</span>
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 20 }}>
          {TILES.map((t) => {
            const s = VERDICT_STYLE[t.v];
            const ex = exampleFor(t.v, claims, results);
            return (
              <div key={t.v} data-reveal="" className="rs-tile rs-card" style={{ position: "relative", overflow: "hidden", borderRadius: 24, padding: 34, display: "flex", flexDirection: "column", gap: 20, minHeight: 380 }}>
                <div aria-hidden style={{ position: "absolute", right: -24, top: -50, fontSize: 260, lineHeight: 1, color: s.color, opacity: isDark ? 0.07 : 0.05, pointerEvents: "none" }}>
                  {s.mark}
                </div>
                <div className="rs-mono" style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8, padding: "6px 14px", border: `1.5px solid ${s.color}`, color: s.color, borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", background: isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.7)" }}>
                  {s.mark} {t.v}
                </div>
                <h3 className="rs-serif" style={{ margin: "6px 0 0", fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.15, color: isDark ? "#FAF8F5" : "#0A0C10" }}>{t.name}</h3>
                <p style={{ margin: 0, color: isDark ? "#94A3B8" : "#475569", fontSize: 15, lineHeight: 1.6 }}>{t.rule}</p>
                {ex && (
                  <div style={{ marginTop: "auto", paddingTop: 20, borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}` }}>
                    <div className="rs-serif" style={{ fontSize: 20, lineHeight: 1.35, color: isDark ? "#FAF8F5" : "#0A0C10", fontStyle: "italic" }}>&ldquo;{ex.claim}&rdquo;</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "#64748B" }}>{ex.reason}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ ...SECTION, padding: "clamp(60px,12vh,140px) clamp(20px,5vw,72px)", maxWidth: 1320 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 56, alignItems: "center" }}>
          <div data-reveal="">
            <div style={{ marginBottom: 18 }}>
              <span className="rs-mono" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 12px", borderRadius: 999, background: "rgba(167, 139, 250, 0.1)", border: "1px solid rgba(167, 139, 250, 0.25)", color: "#A78BFA", fontSize: 11, letterSpacing: "0.14em", fontWeight: 500 }}>
                MANAGED REASONING AGENTS
              </span>
            </div>
            <h2 className="rs-serif" style={{ ...H2, fontSize: "clamp(42px,5vw,72px)", lineHeight: 1.05, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
              Agents investigate.
              <br />
              <span style={{ color: "#64748B", fontStyle: "italic" }}>They never decide.</span>
            </h2>
            <p style={{ margin: "26px 0 0", maxWidth: 500, color: isDark ? "#94A3B8" : "#475569", fontSize: 17, lineHeight: 1.6 }}>
              The Investigator inspects unresolved or occluded moments. The Skeptic seeks contradictory evidence and can only downgrade preliminary verdicts. Neither agent ever sets a final label.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div data-reveal="" className="rs-card" style={{ borderRadius: 20, padding: "24px 26px" }}>
              <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <span style={{ color: "#10B981", fontWeight: 600 }}>investigator · c4#1</span>
                <span style={{ color: "var(--text-muted)" }}>4,120 tok</span>
              </div>
              <div className="rs-mono" style={{ marginTop: 12, fontSize: 15, color: isDark ? "#FAF8F5" : "#0A0C10" }}>inspect CAM C 15–19s (entity)</div>
              <div style={{ marginTop: 6, color: isDark ? "#94A3B8" : "#475569", fontSize: 14, lineHeight: 1.5 }}>Camera B loses the subject behind an occlusion; Camera C is elevated and can see over it.</div>
            </div>
            <div data-reveal="" className="rs-card" style={{ position: "relative", borderRadius: 20, padding: "24px 26px", overflow: "hidden" }}>
              <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <span style={{ color: "#A78BFA", fontWeight: 600 }}>skeptic · c2</span>
                <span style={{ color: "#64748B" }}>enforceDowngradeOnly()</span>
              </div>
              <div className="rs-mono" style={{ marginTop: 14, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 15 }}>
                <span style={{ color: "#F43F5E" }}>Contradicted</span>
                <span style={{ color: "#64748B" }}>→</span>
                <span style={{ color: "#10B981", textDecoration: "line-through", textDecorationColor: isDark ? "#FAF8F5" : "#0A0C10" }}>Supported</span>
              </div>
              <div style={{ marginTop: 6, color: isDark ? "#94A3B8" : "#475569", fontSize: 14, maxWidth: "calc(100% - 120px)" }}>Skeptic may only downgrade to Insufficient.</div>
              <div className="rs-mono" style={{ position: "absolute", right: 22, top: "50%", marginTop: -20, padding: "7px 14px", border: "2px solid #F43F5E", color: "#F43F5E", fontWeight: 600, letterSpacing: "0.2em", fontSize: 13, transform: "rotate(-8deg)", borderRadius: 6, background: isDark ? "rgba(8,9,11,0.85)" : "rgba(255,255,255,0.9)", boxShadow: "0 0 20px rgba(244,63,94,0.3)" }}>
                BLOCKED
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...SECTION, padding: "clamp(60px,12vh,140px) clamp(20px,5vw,72px) 60px", maxWidth: 1320 }}>
        <div
          data-reveal=""
          style={{
            position: "relative",
            overflow: "hidden",
            borderRadius: 32,
            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            padding: "clamp(40px,7vw,96px)",
            background: isDark
              ? "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(15,17,23,0.8) 50%, rgba(8,9,11,0.95) 100%)"
              : "linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(255,255,255,0.92) 50%, rgba(248,249,250,0.98) 100%)",
            backdropFilter: "blur(32px)",
            boxShadow: isDark
              ? "0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.12)"
              : "0 24px 60px -8px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.95)",
            transition: "all 0.4s ease",
          }}
        >
          <h2 className="rs-serif" style={{ margin: 0, fontWeight: 400, fontSize: "clamp(42px,5.4vw,76px)", letterSpacing: "-0.03em", lineHeight: 1.05, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
            See every label&rsquo;s <span style={{ fontStyle: "italic", color: "#10B981" }}>proof.</span>
          </h2>
          <p style={{ margin: "20px 0 0", color: isDark ? "#94A3B8" : "#475569", fontSize: 17, maxWidth: 540, lineHeight: 1.6 }}>
            Replay scene {sceneId} on the board: the multi-angle footage pass, the autonomous agents, and the camera evidence behind each claim.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36 }}>
            <Link href="/new" className="rs-btn rs-btn-primary" style={{ padding: "15px 28px", fontSize: 14, fontWeight: 600 }}>
              Start a new investigation
            </Link>
            <Link href="/board" className="rs-btn rs-btn-ghost" style={{ padding: "15px 28px", fontSize: 14, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
              Open the board
            </Link>
            <Link href="/proof" className="rs-btn rs-btn-ghost" style={{ padding: "15px 28px", fontSize: 14, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
              Open the proof
            </Link>
            <Link href="/capture" className="rs-btn rs-btn-ghost" style={{ padding: "15px 28px", fontSize: 14, color: isDark ? "#FAF8F5" : "#0A0C10" }}>
              Capture walkthrough
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
