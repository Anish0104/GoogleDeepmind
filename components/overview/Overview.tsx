// OWNER: Dev 4. The landing page: hero, how a claim gets its label, the tagline, the three
// labels, the agent safety story, privacy and the call to action.
"use client";

import Link from "next/link";
import { useRef } from "react";
import type { Claim, ClaimResult, Verdict } from "@/lib/types";
import type { HeroVariant } from "@/components/canvas/drawHero";
import { useReveal } from "@/components/site/useReveal";
import { VERDICT_STYLE } from "@/components/verdictStyle";
import { Hero } from "./Hero";
import { exampleFor } from "./hud";

const SECTION = { position: "relative", zIndex: 2, margin: "0 auto" } as const;
const H2 = { margin: 0, fontWeight: 400, fontSize: "clamp(44px,5.6vw,84px)", lineHeight: 0.98, letterSpacing: "-0.02em" } as const;

const HOW = [
  { n: "01", color: "#ECE6DA", title: "Capture and sync", body: "4 phones record around a mat with zones A–F; a clap and a screen flash line them up.", chips: ["clap + flash", "≤ 4 s clips"] },
  { n: "02", color: "#7CC7FF", title: "Evidence", body: "Gemini 4 Hydrogen lists objects and yes/no questions; the Gemini Decisions API answers every question for every camera and half-second slice with a probability.", chips: ["gemini-4-hydrogen", "gemini-decision-1"] },
  { n: "03", color: "#5BE49B", title: "Labels", body: "Fixed TypeScript rules in verdict() turn per-camera evidence into a label. Contradicted is the hardest label to get. Gemini 4 Carbon splits the spoken account into claims and writes a cited timeline.", chips: ["verdict()", "gemini-4-carbon"] },
  { n: "04", color: "#B79CFF", title: "Agents", body: "Two Gemini Managed Agents pick extra clips to check. The Investigator settles undecided claims; the Skeptic can only downgrade a label. Neither agent ever sets one.", chips: ["Investigator", "Skeptic"] },
];

const TILES: { v: Verdict; name: string; rule: string }[] = [
  { v: "Supported", name: "Supported", rule: "Usable cameras (visibility ≥ 0.60) agree and the support score reaches 0.80." },
  { v: "Contradicted", name: "Contradicted by visible evidence", rule: "The contradict score must reach 0.90. It is the hardest label to get." },
  { v: "Insufficient", name: "Insufficient footage", rule: "No usable view at the key moment, or the evidence clears neither bar." },
];

const TAGLINE = "Many angles on one moment. Each claim gets the label the footage supports, and never a verdict on the person.";

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
  useReveal(root);

  return (
    <div ref={root}>
      <Hero variant={variant} sceneId={sceneId} claims={claims} results={results} />

      <section style={{ ...SECTION, padding: "clamp(80px,14vh,160px) clamp(20px,5vw,72px)", maxWidth: 1320 }}>
        <div data-reveal="" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginBottom: 64 }}>
          <h2 style={{ ...H2, maxWidth: 760 }}>How a claim gets its label</h2>
          <p style={{ margin: 0, maxWidth: 360, color: "#9AA0A8", fontSize: 15, lineHeight: 1.6 }}>
            Four stages, four owners, one contract in <span className="rs-mono" style={{ color: "#ECE6DA" }}>lib/types.ts</span>.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 1, background: "rgba(236,230,218,0.08)", border: "1px solid rgba(236,230,218,0.08)", borderRadius: 20, overflow: "hidden" }}>
          {HOW.map((s) => (
            <div key={s.n} data-reveal="" className="rs-hover-raise" style={{ background: "#131209", padding: "32px 28px 36px", display: "flex", flexDirection: "column", gap: 18, minHeight: 340 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="rs-mono" style={{ fontSize: 12, color: s.color }}>{s.n}</span>
                <span style={{ width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(236,230,218,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, boxShadow: `0 0 14px ${s.color}` }} />
                </span>
              </div>
              <h3 style={{ margin: "24px 0 0", fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>{s.title}</h3>
              <p style={{ margin: 0, color: "#9AA0A8", fontSize: 15, lineHeight: 1.6, textWrap: "pretty", flex: 1 }}>{s.body}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {s.chips.map((c) => (
                  <span key={c} className="rs-mono" style={{ fontSize: 12, color: "#C9C2B4", border: "1px solid rgba(236,230,218,0.14)", borderRadius: 999, padding: "4px 10px" }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...SECTION, padding: "96px clamp(20px,5vw,72px)", display: "flex", justifyContent: "center" }}>
        <p style={{ margin: 0, maxWidth: 680, fontSize: "clamp(36px,5vw,60px)", lineHeight: 1, fontWeight: 600, letterSpacing: "-0.03em", display: "flex", flexWrap: "wrap", columnGap: "0.26em", rowGap: 8 }}>
          {TAGLINE.split(" ").map((w, i) => (
            <span key={i} data-word="" style={{ color: "#ECE6DA", opacity: 0.3, transition: "opacity .6s cubic-bezier(.22,1,.36,1)" }}>
              {w}
            </span>
          ))}
        </p>
      </section>

      <section style={{ ...SECTION, padding: "clamp(40px,8vh,100px) clamp(20px,5vw,72px)", maxWidth: 1320 }}>
        <h2 data-reveal="" style={{ ...H2, margin: "0 0 56px", maxWidth: 900 }}>
          Three labels. <span style={{ color: "#9AA0A8" }}>None of them about a person.</span>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 16 }}>
          {TILES.map((t) => {
            const s = VERDICT_STYLE[t.v];
            const ex = exampleFor(t.v, claims, results);
            return (
              <div key={t.v} data-reveal="" className="rs-tile" style={{ position: "relative", overflow: "hidden", border: "1px solid rgba(236,230,218,0.09)", borderRadius: 20, padding: 32, background: "#131209", display: "flex", flexDirection: "column", gap: 20, minHeight: 380 }}>
                <div aria-hidden style={{ position: "absolute", right: -30, top: -60, fontSize: 300, lineHeight: 1, color: s.color, opacity: 0.09, pointerEvents: "none" }}>
                  {s.mark}
                </div>
                <div className="rs-mono" style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 8, padding: "6px 12px", border: `1.5px solid ${s.color}`, color: s.color, borderRadius: 6, fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                  {s.mark} {t.v}
                </div>
                <h3 style={{ margin: "8px 0 0", fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{t.name}</h3>
                <p style={{ margin: 0, color: "#9AA0A8", fontSize: 15, lineHeight: 1.6 }}>{t.rule}</p>
                {ex && (
                  <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid rgba(236,230,218,0.08)" }}>
                    <div style={{ fontSize: 20, lineHeight: 1.3 }}>&ldquo;{ex.claim}&rdquo;</div>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: "#8A9099" }}>{ex.reason}</div>
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
            <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#B79CFF", marginBottom: 20 }}>MANAGED AGENTS</div>
            <h2 style={{ ...H2, fontSize: "clamp(44px,5.2vw,76px)", lineHeight: 1 }}>
              Agents investigate.
              <br />
              <span style={{ color: "#9AA0A8" }}>They never decide.</span>
            </h2>
            <p style={{ margin: "28px 0 0", maxWidth: 500, color: "#A9AEB5", fontSize: 17, lineHeight: 1.6 }}>
              The Investigator settles undecided claims. The Skeptic looks for footage that would break a decided label and can only downgrade it. Neither agent ever sets a label.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div data-reveal="" style={{ border: "1px solid rgba(124,199,255,0.22)", background: "#181818", borderRadius: 18, padding: "22px 24px" }}>
              <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <span style={{ color: "#7CC7FF" }}>investigator · c4#1</span>
                <span style={{ color: "#7D838C" }}>4120 tok · $0.03</span>
              </div>
              <div className="rs-mono" style={{ marginTop: 12, fontSize: 15 }}>inspect CAM C 15–19s (entity)</div>
              <div style={{ marginTop: 6, color: "#9AA0A8", fontSize: 14, lineHeight: 1.5 }}>B loses the box behind a hand; C is high and wide and may see over it.</div>
            </div>
            <div data-reveal="" style={{ position: "relative", border: "1px solid rgba(183,156,255,0.25)", background: "#181818", borderRadius: 18, padding: "22px 24px", overflow: "hidden" }}>
              <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                <span style={{ color: "#B79CFF" }}>skeptic · c2</span>
                <span style={{ color: "#7D838C" }}>enforceDowngradeOnly()</span>
              </div>
              <div className="rs-mono" style={{ marginTop: 14, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 15 }}>
                <span style={{ color: "#FF5A47" }}>Contradicted</span>
                <span style={{ color: "#5E646D" }}>→</span>
                <span style={{ color: "#5BE49B", textDecoration: "line-through", textDecorationColor: "#ECE6DA" }}>Supported</span>
              </div>
              <div style={{ marginTop: 6, color: "#9AA0A8", fontSize: 14, maxWidth: "calc(100% - 120px)" }}>Skeptic may only downgrade to Insufficient.</div>
              <div className="rs-mono" style={{ position: "absolute", right: 22, top: "50%", marginTop: -20, padding: "8px 14px", border: "2px solid #FF5A47", color: "#FF5A47", fontWeight: 600, letterSpacing: "0.2em", fontSize: 14, transform: "rotate(-8deg)", borderRadius: 4, background: "rgba(6,7,9,0.7)" }}>
                BLOCKED
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...SECTION, padding: "clamp(60px,12vh,140px) clamp(20px,5vw,72px)", maxWidth: 1100, textAlign: "center" }}>
        <div data-reveal="" className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#7D838C", marginBottom: 28 }}>PRIVACY</div>
        <p data-reveal="" style={{ margin: 0, fontSize: "clamp(32px,4vw,56px)", lineHeight: 1.15, letterSpacing: "-0.01em", textWrap: "balance" }}>
          Raw video stays on the laptop. Only short validated clips <span style={{ color: "#9AA0A8" }}>(4 s or less)</span> and low resolution stills go to the models. No face recognition.
        </p>
      </section>

      <section style={{ ...SECTION, padding: "clamp(60px,12vh,140px) clamp(20px,5vw,72px) 60px", maxWidth: 1320 }}>
        <div data-reveal="" style={{ position: "relative", overflow: "hidden", borderRadius: 28, border: "1px solid rgba(236,230,218,0.1)", padding: "clamp(40px,7vw,96px)", background: "#131209" }}>
          <h2 style={{ margin: 0, fontWeight: 500, fontSize: "clamp(40px,5vw,72px)", letterSpacing: "-0.04em", lineHeight: 1 }}>See every label’s proof.</h2>
          <p style={{ margin: "18px 0 0", color: "#9AA0A8", fontSize: 17, maxWidth: 520, lineHeight: 1.55 }}>
            Replay scene {sceneId} on the board: the footage pass, the agents, and the evidence behind each claim.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36 }}>
            <Link href="/board" className="rs-btn rs-btn-primary" style={{ padding: "15px 26px", fontSize: 15 }}>
              Open the board
            </Link>
            <Link href="/proof" className="rs-btn rs-btn-line" style={{ padding: "15px 26px", fontSize: 15, color: "#ECE6DA" }}>
              Open the proof
            </Link>
            <Link href="/capture" className="rs-btn rs-btn-line" style={{ padding: "15px 26px", fontSize: 15, color: "#ECE6DA" }}>
              Start from capture
            </Link>
          </div>
        </div>
        <div className="rs-mono" style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginTop: 40, fontSize: 11, letterSpacing: "0.08em", color: "#5E646D" }}>
          <span>RASHOMON · Gemini 4 NYC Hackathon · Problem Statement Two: Element 119</span>
          <span>Best Use of Managed Agents</span>
        </div>
      </section>
    </div>
  );
}
