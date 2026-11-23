// OWNER: Dev 4. The floating glass nav pill: brand, the five screens with a sliding active
// pill, live telemetry chip (clock, camera equalizer), crazy white/dark mode toggle, and New investigation button.
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
import { useTheme } from "./ThemeContext";
import { ThemeToggle } from "./ThemeToggle";

const EASE = "cubic-bezier(.22,1,.36,1)";

export function Logo({ size = 20, isDark = true }: { size?: number; isDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <g stroke={isDark ? "#FAF8F5" : "#0A0C10"} strokeWidth="1.6" strokeLinecap="round">
        <path d="M2 3 L13 13" />
        <path d="M24 3 L13 13" />
        <path d="M2 23 L13 13" opacity="0.55" />
        <path d="M24 23 L13 13" opacity="0.3" />
      </g>
      <circle cx="13" cy="13" r="3.2" fill="#10B981" />
    </svg>
  );
}

function PlayGlyph({ w = 7, h = 9, isDark = true }: { w?: number; h?: number; isDark?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 0,
        height: 0,
        borderLeft: `${w}px solid ${isDark ? "#08090B" : "#FAF8F5"}`,
        borderTop: `${h / 2}px solid transparent`,
        borderBottom: `${h / 2}px solid transparent`,
      }}
    />
  );
}
export { PlayGlyph };

function LiveChip() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
        background: isDark ? "rgba(10,12,16,0.75)" : "rgba(0,0,0,0.04)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
        fontSize: 12,
        lineHeight: "16px",
        transition: "all 0.4s ease",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "#10B981",
          animation: `rsPulse 1.8s ${EASE} infinite`,
        }}
      />
      <span style={{ color: isDark ? "#94A3B8" : "#64748B" }}>demo 001</span>
      <span style={{ color: isDark ? "#FAF8F5" : "#0A0C10", minWidth: 62, fontWeight: 500 }}>{time}</span>
      <span style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 12 }}>
        {(["A", "B", "C", "D"] as CameraId[]).map((c, i) => {
          const off = excluded.includes(c);
          const inspecting = ins?.camera === c;
          const h = off ? 3 : inspecting ? 12 : 5 + Math.round(4 * Math.abs(Math.sin(T * 2 + i * 1.3)));
          const color = off
            ? (isDark ? "#475569" : "#CBD5E1")
            : inspecting && ins
              ? AGENT_COLOR[ins.step.agent]
              : "#10B981";
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
  const { theme } = useTheme();
  const isDark = theme === "dark";
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
    <span
      className={cls}
      style={{
        width: 1,
        height: 20,
        background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        transition: "background 0.4s ease",
      }}
    />
  );

  return (
    <>
      <nav
        aria-label="Primary"
        style={{
          position: "fixed",
          top: 16,
          left: 0,
          right: 0,
          zIndex: 55,
          display: "flex",
          justifyContent: "center",
          padding: "0 12px",
          pointerEvents: "none",
        }}
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
            background: isDark
              ? scrolled
                ? "rgba(9,10,13,0.92)"
                : "rgba(12,14,18,0.72)"
              : scrolled
                ? "rgba(255,255,255,0.92)"
                : "rgba(255,255,255,0.84)",
            backdropFilter: "blur(32px) saturate(190%)",
            WebkitBackdropFilter: "blur(32px) saturate(190%)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            boxShadow: isDark
              ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(16,185,129,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.95), 0 16px 48px -8px rgba(0,0,0,0.1), 0 0 30px rgba(16,185,129,0.08)",
            overflow: "hidden",
            transform: scrolled ? "scale(0.97)" : "none",
            transition: `transform .5s ${EASE}, background .4s ${EASE}, border-color .4s ${EASE}, box-shadow .4s ${EASE}`,
          }}
        >
          {/* Animated subtle light sweep beam */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 180,
              height: 1,
              background: "linear-gradient(90deg,rgba(52,211,153,0),rgba(52,211,153,0.9),rgba(52,211,153,0))",
              animation: `rsSweep 7s ${EASE} infinite`,
              pointerEvents: "none",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 120,
              height: 1,
              background: "linear-gradient(90deg,rgba(16,185,129,0),rgba(16,185,129,0.6),rgba(16,185,129,0))",
              animation: `rsSweepR 9s ${EASE} infinite`,
              pointerEvents: "none",
            }}
          />

          {/* Brand Lockup */}
          <Link
            href="/"
            aria-label="VERA home"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: isDark ? "#FAF8F5" : "#0A0C10",
              padding: "0 12px 0 0",
              height: 36,
              borderRadius: 999,
              transition: "color 0.4s ease",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: isDark ? "#08090B" : "#FFFFFF",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isDark
                  ? "inset 0 0 12px rgba(16,185,129,0.15)"
                  : "0 2px 8px rgba(0,0,0,0.05), inset 0 0 8px rgba(16,185,129,0.1)",
                transition: "all 0.4s ease",
              }}
            >
              <Logo isDark={isDark} />
            </span>
            <span className="hidden min-[520px]:flex" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, lineHeight: 1 }}>
              <span className="rs-mono" style={{ fontWeight: 600, letterSpacing: "0.28em", fontSize: 12 }}>VERA</span>
              <span className="rs-mono" style={{ fontSize: 9, letterSpacing: "0.16em", color: isDark ? "#64748B" : "#94A3B8" }}>
                EVIDENCE ENGINE
              </span>
            </span>
          </Link>

          {divider("hidden min-[880px]:block")}

          {/* Navigation Links with Gliding Pill */}
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
                background: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
                boxSizing: "border-box",
                boxShadow: isDark
                  ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px rgba(16,185,129,0.1)"
                  : "inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 10px rgba(0,0,0,0.05)",
                transform: `translateX(${Math.max(0, idx) * 96}px)`,
                opacity: idx < 0 ? 0 : 1,
                transition: `transform .5s ${EASE}, opacity .3s ${EASE}, background .4s ease, border-color .4s ease`,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: -1,
                  width: 16,
                  height: 2,
                  marginLeft: -8,
                  borderRadius: 2,
                  background: "#10B981",
                  boxShadow: "0 0 10px #10B981",
                }}
              />
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
                  color: i === idx ? (isDark ? "#FAF8F5" : "#0A0C10") : isDark ? "#94A3B8" : "#64748B",
                  borderRadius: 999,
                  transition: `color .3s ${EASE}`,
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {divider("hidden min-[1180px]:block")}

          {/* Telemetry Module */}
          <LiveChip />

          {/* Crazy Theme Toggle */}
          <ThemeToggle />

          {/* New Investigation CTA */}
          <Link
            href="/new"
            className="rs-cta-btn"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              background: isDark ? "#FAF8F5" : "#0A0C10",
              color: isDark ? "#08090B" : "#FAF8F5",
              border: 0,
              borderRadius: 999,
              padding: "0 18px",
              fontSize: 14,
              lineHeight: "20px",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: `transform .3s ${EASE}, box-shadow .3s ${EASE}, background .3s ${EASE}, color .3s ${EASE}`,
            }}
          >
            <span aria-hidden style={{ fontSize: 16, lineHeight: "16px", marginTop: -1 }}>+</span>
            <span className="hidden min-[440px]:inline">New investigation</span>
            <span className="min-[440px]:hidden">New</span>
          </Link>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex min-[880px]:hidden"
            style={{
              position: "relative",
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
              background: isDark ? "#08090B" : "#FFFFFF",
              cursor: "pointer",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
              transition: "all 0.4s ease",
            }}
          >
            {[menuOpen ? "rotate(45deg)" : "translateY(-3px)", menuOpen ? "rotate(-45deg)" : "translateY(3px)"].map(
              (tf, i) => (
                <span
                  key={i}
                  style={{
                    position: "absolute",
                    left: 10,
                    width: 14,
                    height: 1.5,
                    background: isDark ? "#FAF8F5" : "#0A0C10",
                    borderRadius: 1,
                    transform: tf,
                    transition: `transform .5s ${EASE}, background .4s ease`,
                  }}
                />
              ),
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Overlay */}
      <div
        className="min-[880px]:hidden"
        aria-hidden={!menuOpen}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 54,
          background: isDark ? "rgba(8,9,11,0.96)" : "rgba(248,249,250,0.96)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: `opacity .5s ${EASE}, background .4s ease`,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px 32px 48px",
          gap: 12,
        }}
      >
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            className="rs-mono"
            style={{ fontSize: 11, letterSpacing: "0.14em", color: isDark ? "#64748B" : "#94A3B8" }}
          >
            NAVIGATION
          </span>
          <ThemeToggle showLabel={true} />
        </div>
        {NAV_ITEMS.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuOpen(false)}
            className="rs-serif"
            style={{
              padding: "10px 0",
              fontSize: 34,
              lineHeight: "38px",
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: i === idx ? "#10B981" : isDark ? "#FAF8F5" : "#0A0C10",
              opacity: menuOpen ? 1 : 0,
              transform: menuOpen ? "none" : "translateY(24px)",
              transition: `opacity .5s ${EASE} ${menuOpen ? i * 50 : 0}ms, transform .5s ${EASE} ${menuOpen ? i * 50 : 0}ms, color .3s ease`,
            }}
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/new"
          tabIndex={menuOpen ? 0 : -1}
          onClick={() => setMenuOpen(false)}
          className="rs-mono"
          style={{
            marginTop: 24,
            padding: "14px 24px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 999,
            textAlign: "center",
            background: isDark ? "#FAF8F5" : "#0A0C10",
            color: isDark ? "#08090B" : "#FAF8F5",
            opacity: menuOpen ? 1 : 0,
            transition: `opacity .5s ${EASE}`,
          }}
        >
          + New investigation
        </Link>
      </div>
    </>
  );
}
