// OWNER: Dev 4. The floating glass nav pill: brand, the five screens with a sliding active
// pill, crazy white/dark mode toggle, and New investigation button. Inspired by Wispr Flow.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS, navIndex } from "./routes";
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

  return (
    <>
      <nav
        aria-label="Primary"
        style={{
          position: "fixed",
          top: 18,
          left: 0,
          right: 0,
          zIndex: 55,
          display: "flex",
          justifyContent: "center",
          padding: "0 16px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "5px 6px 5px 12px",
            borderRadius: 999,
            background: isDark
              ? scrolled
                ? "rgba(10,12,16,0.92)"
                : "rgba(12,14,18,0.78)"
              : scrolled
                ? "rgba(255,255,255,0.92)"
                : "rgba(255,255,255,0.85)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
            boxShadow: isDark
              ? "inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 60px rgba(0,0,0,0.55), 0 0 40px rgba(16,185,129,0.06)"
              : "inset 0 1px 0 rgba(255,255,255,0.95), 0 16px 48px -8px rgba(0,0,0,0.08), 0 0 30px rgba(16,185,129,0.06)",
            transform: scrolled ? "scale(0.98)" : "none",
            transition: `transform .5s ${EASE}, background .4s ${EASE}, border-color .4s ${EASE}, box-shadow .4s ${EASE}`,
          }}
        >
          {/* Brand Lockup */}
          <Link
            href="/"
            aria-label="VERA home"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: isDark ? "#FAF8F5" : "#0A0C10",
              padding: "0 6px 0 0",
              height: 36,
              borderRadius: 999,
              transition: "color 0.4s ease",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: isDark ? "#08090B" : "#FFFFFF",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isDark
                  ? "inset 0 0 10px rgba(16,185,129,0.15)"
                  : "0 2px 6px rgba(0,0,0,0.05), inset 0 0 6px rgba(16,185,129,0.1)",
                transition: "all 0.4s ease",
              }}
            >
              <Logo size={18} isDark={isDark} />
            </span>
            <span
              className="rs-mono"
              style={{
                fontWeight: 600,
                letterSpacing: "0.2em",
                fontSize: 13,
                color: isDark ? "#FAF8F5" : "#0A0C10",
              }}
            >
              VERA
            </span>
          </Link>

          {/* Navigation Links with Gliding Pill */}
          <div
            className="hidden min-[840px]:grid"
            style={{
              position: "relative",
              gridTemplateColumns: "repeat(5,92px)",
              height: 36,
              background: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
              borderRadius: 999,
              padding: 2,
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 2,
                left: 2,
                width: 88,
                height: 32,
                borderRadius: 999,
                background: isDark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.95)",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)"}`,
                boxSizing: "border-box",
                boxShadow: isDark
                  ? "inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 8px rgba(0,0,0,0.4)"
                  : "0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1)",
                transform: `translateX(${Math.max(0, idx) * 92}px)`,
                opacity: idx < 0 ? 0 : 1,
                transition: `transform .45s ${EASE}, opacity .3s ${EASE}, background .4s ease, border-color .4s ease`,
                pointerEvents: "none",
              }}
            />
            {NAV_ITEMS.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={i === idx ? "page" : undefined}
                className="rs-navlink"
                style={{
                  position: "relative",
                  zIndex: 1,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: i === idx ? 600 : 500,
                  color: i === idx ? (isDark ? "#FAF8F5" : "#0A0C10") : isDark ? "#94A3B8" : "#64748B",
                  borderRadius: 999,
                  textDecoration: "none",
                  transition: `color .3s ${EASE}`,
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {/* Right Controls: Crazy Theme Toggle + CTA */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThemeToggle />

            <Link
              href="/new"
              className="rs-cta-btn"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 36,
                background: isDark ? "#FAF8F5" : "#0A0C10",
                color: isDark ? "#08090B" : "#FAF8F5",
                border: 0,
                borderRadius: 999,
                padding: "0 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                textDecoration: "none",
                boxShadow: isDark
                  ? "0 4px 16px rgba(255,255,255,0.08)"
                  : "0 4px 16px rgba(0,0,0,0.12)",
                transition: `transform .3s ${EASE}, box-shadow .3s ${EASE}, background .3s ${EASE}, color .3s ${EASE}`,
              }}
            >
              <span aria-hidden style={{ fontSize: 16, lineHeight: "14px", marginTop: -1 }}>+</span>
              <span className="hidden min-[480px]:inline">New investigation</span>
              <span className="min-[480px]:hidden">New</span>
            </Link>

            {/* Mobile Menu Toggle Button */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="flex min-[840px]:hidden"
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
        </div>
      </nav>

      {/* Mobile Drawer Overlay */}
      <div
        className="min-[840px]:hidden"
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
