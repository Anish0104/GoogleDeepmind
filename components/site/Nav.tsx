// OWNER: Dev 4. The floating glass nav pill: brand, the five screens with a sliding active
// pill, the live chip (clock and camera bars) and the New investigation button.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { CameraId } from "@/lib/types";
import { fmt } from "@/components/canvas/math";
import { inspectAt } from "@/components/replay/timeline";
import { AGENT_COLOR } from "@/components/verdictStyle";
import { NAV_ITEMS, navIndex } from "./routes";
import { useSite } from "./SiteStore";

const EASE = "cubic-bezier(.22,1,.36,1)";

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <g stroke="#FAF8F5" strokeWidth="1.6" strokeLinecap="round">
        <path d="M2 3 L13 13" />
        <path d="M24 3 L13 13" />
        <path d="M2 23 L13 13" opacity="0.55" />
        <path d="M24 23 L13 13" opacity="0.3" />
      </g>
      <circle cx="13" cy="13" r="3.2" fill="#10B981" />
    </svg>
  );
}

function PlayGlyph({ w = 7, h = 9 }: { w?: number; h?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: 0,
        height: 0,
        borderLeft: `${w}px solid #08090B`,
        borderTop: `${h / 2}px solid transparent`,
        borderBottom: `${h / 2}px solid transparent`,
      }}
    />
  );
}
export { PlayGlyph };

function LiveChip() {
  const { T, foot, excluded, timeline } = useSite();
  const ins = timeline ? inspectAt(timeline, T) : null;
  const time = T <= foot ? fmt(T) : `AGT +${(T - foot).toFixed(1)}`;
  return (
    <div
      className="rs-mono hidden min-[1180px]:flex"
      style={{
        alignItems: "center",
        gap: 8,
        height: 36,
        padding: "0 12px",
        borderRadius: 999,
        background: "rgba(10,12,16,0.75)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontSize: 12,
        lineHeight: "16px",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", animation: `rsPulse 1.8s ${EASE} infinite` }} />
      <span style={{ color: "#94A3B8" }}>demo 001</span>
      <span style={{ color: "#FAF8F5", minWidth: 64 }}>{time}</span>
      <span style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 12 }}>
        {(["A", "B", "C", "D"] as CameraId[]).map((c, i) => {
          const off = excluded.includes(c);
          const inspecting = ins?.camera === c;
          const h = off ? 3 : inspecting ? 12 : 5 + Math.round(4 * Math.abs(Math.sin(T * 2 + i * 1.3)));
          const color = off ? "#475569" : inspecting && ins ? AGENT_COLOR[ins.step.agent] : "#34D399";
          return (
            <span
              key={c}
              style={{ width: 3, height: h, borderRadius: 1, background: color, transition: `height .3s ${EASE}` }}
            />
          );
        })}
      </span>
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const idx = navIndex(pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  const divider = (cls: string) => (
    <span className={cls} style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)" }} />
  );

  return (
    <>
      <nav
        aria-label="Primary"
        style={{ position: "fixed", top: 16, left: 0, right: 0, zIndex: 55, display: "flex", justifyContent: "center", padding: "0 12px", pointerEvents: "none" }}
      >
        <div
          style={{
            pointerEvents: "auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 6,
            borderRadius: 999,
            background: scrolled ? "rgba(9,10,13,0.88)" : "rgba(12,14,18,0.68)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(16,185,129,0.06)",
            overflow: "hidden",
            transform: scrolled ? "scale(0.97)" : "none",
            transition: `transform .5s ${EASE},background .3s ${EASE}`,
          }}
        >
          <span
            aria-hidden
            style={{ position: "absolute", top: 0, left: 0, width: 180, height: 1, background: "linear-gradient(90deg,rgba(52,211,153,0),rgba(52,211,153,0.9),rgba(52,211,153,0))", animation: `rsSweep 7s ${EASE} infinite`, pointerEvents: "none" }}
          />
          <span
            aria-hidden
            style={{ position: "absolute", bottom: 0, right: 0, width: 120, height: 1, background: "linear-gradient(90deg,rgba(16,185,129,0),rgba(16,185,129,0.6),rgba(16,185,129,0))", animation: `rsSweepR 9s ${EASE} infinite`, pointerEvents: "none" }}
          />
          <Link
            href="/"
            aria-label="VERA home"
            style={{ display: "flex", alignItems: "center", gap: 12, color: "#FAF8F5", padding: "0 12px 0 0", height: 36, borderRadius: 999 }}
          >
            <span
              style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", background: "#08090B", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 12px rgba(16,185,129,0.15)" }}
            >
              <Logo />
            </span>
            <span className="hidden min-[520px]:flex" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, lineHeight: 1 }}>
              <span className="rs-mono" style={{ fontWeight: 600, letterSpacing: "0.28em", fontSize: 12 }}>VERA</span>
              <span className="rs-mono" style={{ fontSize: 9, letterSpacing: "0.16em", color: "#64748B" }}>EVIDENCE ENGINE</span>
            </span>
          </Link>
          {divider("hidden min-[880px]:block")}
          <div className="hidden min-[880px]:grid" style={{ position: "relative", gridTemplateColumns: "repeat(5,96px)", height: 36 }}>
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 96,
                height: 36,
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxSizing: "border-box",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px rgba(16,185,129,0.1)",
                transform: `translateX(${Math.max(0, idx) * 96}px)`,
                opacity: idx < 0 ? 0 : 1,
                transition: `transform .5s ${EASE}, opacity .3s ${EASE}`,
                pointerEvents: "none",
              }}
            >
              <span style={{ position: "absolute", left: "50%", bottom: -1, width: 16, height: 2, marginLeft: -8, borderRadius: 2, background: "#34D399", boxShadow: "0 0 10px #34D399" }} />
            </span>
            {NAV_ITEMS.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={i === idx ? "page" : undefined}
                className="rs-navlink"
                style={{
                  position: "relative",
                  zIndex: 1,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  lineHeight: "20px",
                  fontWeight: 500,
                  color: i === idx ? "#FAF8F5" : "#94A3B8",
                  borderRadius: 999,
                  transition: `color .3s ${EASE}`,
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
          {divider("hidden min-[1180px]:block")}
          <LiveChip />
          <Link
            href="/new"
            className="rs-cta-btn"
            style={{ display: "flex", alignItems: "center", gap: 8, height: 36, background: "#FAF8F5", color: "#08090B", border: 0, borderRadius: 999, padding: "0 16px", fontSize: 14, lineHeight: "20px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <span aria-hidden style={{ fontSize: 16, lineHeight: "16px", marginTop: -1 }}>+</span>
            <span className="hidden min-[400px]:inline">New investigation</span>
            <span className="min-[400px]:hidden">New</span>
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex min-[880px]:hidden"
            style={{ position: "relative", width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", background: "#08090B", cursor: "pointer", alignItems: "center", justifyContent: "center", flex: "none" }}
          >
            {[menuOpen ? "rotate(45deg)" : "translateY(-3px)", menuOpen ? "rotate(-45deg)" : "translateY(3px)"].map((tf, i) => (
              <span key={i} style={{ position: "absolute", left: 10, width: 14, height: 1.5, background: "#FAF8F5", borderRadius: 1, transform: tf, transition: `transform .5s ${EASE}` }} />
            ))}
          </button>
        </div>
      </nav>
      <div
        className="min-[880px]:hidden"
        aria-hidden={!menuOpen}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 54,
          background: "rgba(8,9,11,0.95)",
          backdropFilter: "blur(30px)",
          WebkitBackdropFilter: "blur(30px)",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: `opacity .5s ${EASE}`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px 32px 48px",
          gap: 8,
        }}
      >
        {NAV_ITEMS.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuOpen(false)}
            style={{
              padding: "8px 0",
              fontSize: 36,
              lineHeight: "40px",
              fontWeight: 600,
              letterSpacing: "-0.02em",
              color: i === idx ? "#FAF8F5" : "#94A3B8",
              opacity: menuOpen ? 1 : 0,
              transform: menuOpen ? "none" : "translateY(24px)",
              transition: `opacity .5s ${EASE} ${menuOpen ? i * 60 : 0}ms,transform .5s ${EASE} ${menuOpen ? i * 60 : 0}ms`,
            }}
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/new"
          tabIndex={menuOpen ? 0 : -1}
          onClick={() => setMenuOpen(false)}
          style={{ marginTop: 16, padding: "8px 0", fontSize: 20, fontWeight: 500, color: "#34D399", opacity: menuOpen ? 1 : 0, transition: `opacity .5s ${EASE}` }}
        >
          + New investigation
        </Link>
      </div>
    </>
  );
}
