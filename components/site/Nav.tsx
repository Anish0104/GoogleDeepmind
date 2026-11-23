// OWNER: Dev 4. Modern floating island navigation: fluid sliding tab pill,
// micro-glass blur, theme toggle, and tactile investigation CTA.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS, navIndex } from "./routes";
import { useTheme } from "./ThemeContext";
import { ThemeToggle } from "./ThemeToggle";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function Logo({ size = 18, isDark = true }: { size?: number; isDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2L2 20H22L12 2Z"
        stroke={isDark ? "#F5F5F7" : "#1D1D1F"}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M12 2L15 20"
        stroke="#30D158"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14" r="2" fill="#30D158" />
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
        borderLeft: `${w}px solid ${isDark ? "#000000" : "#FFFFFF"}`,
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
    const onScroll = () => setScrolled(window.scrollY > 16);
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
          top: 16,
          left: 0,
          right: 0,
          zIndex: 100,
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
            gap: 10,
            padding: "5px 6px 5px 12px",
            borderRadius: 999,
            background: isDark
              ? scrolled
                ? "rgba(18, 18, 22, 0.92)"
                : "rgba(18, 18, 22, 0.78)"
              : scrolled
                ? "rgba(255, 255, 255, 0.94)"
                : "rgba(255, 255, 255, 0.86)",
            backdropFilter: "blur(28px) saturate(190%)",
            WebkitBackdropFilter: "blur(28px) saturate(190%)",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"}`,
            boxShadow: isDark
              ? "0 20px 50px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)"
              : "0 14px 36px -6px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,1)",
            transform: scrolled ? "scale(0.98)" : "none",
            transition: `transform 0.4s ${EASE}, background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease`,
          }}
        >
          {/* Brand Lockup */}
          <Link
            href="/"
            aria-label="VERA home"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 6px 0 0",
              height: 34,
              borderRadius: 999,
              textDecoration: "none",
              color: isDark ? "#F5F5F7" : "#1D1D1F",
              transition: "opacity 0.2s ease",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
              }}
            >
              <Logo size={15} isDark={isDark} />
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 13.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              VERA
            </span>
          </Link>

          {/* Gliding Navigation Capsule */}
          <div
            className="hidden min-[820px]:grid"
            style={{
              position: "relative",
              gridTemplateColumns: "repeat(5, 88px)",
              height: 34,
              background: isDark ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.035)",
              borderRadius: 999,
              padding: 2,
              boxSizing: "border-box",
            }}
          >
            {/* Smooth Gliding Active Pill */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 2,
                left: 2,
                width: 84,
                height: 30,
                borderRadius: 999,
                background: isDark ? "rgba(255,255,255,0.12)" : "#FFFFFF",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.05)"}`,
                boxSizing: "border-box",
                boxShadow: isDark
                  ? "0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)"
                  : "0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03), inset 0 1px 0 rgba(255,255,255,1)",
                transform: `translateX(${Math.max(0, idx) * 88}px)`,
                opacity: idx < 0 ? 0 : 1,
                transition: `transform 0.35s ${EASE}, opacity 0.25s ease, background 0.3s ease`,
                pointerEvents: "none",
              }}
            />
            {NAV_ITEMS.map((item, i) => {
              const active = i === idx;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12.5,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: "-0.01em",
                    color: active ? (isDark ? "#FFFFFF" : "#1D1D1F") : isDark ? "#86868B" : "#86868B",
                    borderRadius: 999,
                    textDecoration: "none",
                    transition: `color 0.25s ${EASE}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = isDark ? "#F5F5F7" : "#1D1D1F";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "#86868B";
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Right Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThemeToggle size={30} />

            <Link
              href="/new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 32,
                padding: "0 15px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                background: isDark ? "#FFFFFF" : "#1D1D1F",
                color: isDark ? "#000000" : "#FFFFFF",
                textDecoration: "none",
                whiteSpace: "nowrap",
                boxShadow: isDark
                  ? "0 2px 10px rgba(255,255,255,0.12)"
                  : "0 2px 10px rgba(0,0,0,0.14)",
                transition: `transform 0.2s ${EASE}, opacity 0.2s ${EASE}, box-shadow 0.2s ease`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.88";
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = "1";
                e.currentTarget.style.transform = "none";
              }}
            >
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1, marginTop: -1 }}>+</span>
              <span className="hidden min-[480px]:inline">New investigation</span>
              <span className="min-[480px]:hidden">New</span>
            </Link>

            {/* Mobile Menu Hamburger */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="flex min-[820px]:hidden"
              style={{
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "none",
                background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                cursor: "pointer",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              <div style={{ width: 14, height: 10, position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: menuOpen ? 4.5 : 0,
                    width: "100%",
                    height: 1.5,
                    borderRadius: 1,
                    background: isDark ? "#F5F5F7" : "#1D1D1F",
                    transform: menuOpen ? "rotate(45deg)" : "none",
                    transition: "transform 0.25s ease, top 0.25s ease",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    bottom: menuOpen ? 4.5 : 0,
                    width: "100%",
                    height: 1.5,
                    borderRadius: 1,
                    background: isDark ? "#F5F5F7" : "#1D1D1F",
                    transform: menuOpen ? "rotate(-45deg)" : "none",
                    transition: "transform 0.25s ease, bottom 0.25s ease",
                  }}
                />
              </div>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer Overlay */}
      <div
        className="min-[820px]:hidden"
        aria-hidden={!menuOpen}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99,
          background: isDark ? "rgba(8,9,11,0.95)" : "rgba(245,245,247,0.95)",
          backdropFilter: "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: "opacity 0.3s ease",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "96px 32px 48px",
          gap: 16,
        }}
      >
        {NAV_ITEMS.map((item, i) => {
          const active = i === idx;
          return (
            <Link
              key={item.href}
              href={item.href}
              tabIndex={menuOpen ? 0 : -1}
              onClick={() => setMenuOpen(false)}
              style={{
                padding: "12px 0",
                fontSize: 28,
                fontWeight: active ? 600 : 400,
                letterSpacing: "-0.02em",
                color: active ? (isDark ? "#FFFFFF" : "#1D1D1F") : "#86868B",
                textDecoration: "none",
                borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
              }}
            >
              {item.label}
            </Link>
          );
        })}

        <Link
          href="/new"
          tabIndex={menuOpen ? 0 : -1}
          onClick={() => setMenuOpen(false)}
          style={{
            marginTop: 20,
            padding: "14px 24px",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: 999,
            textAlign: "center",
            textDecoration: "none",
            background: isDark ? "#FFFFFF" : "#1D1D1F",
            color: isDark ? "#000000" : "#FFFFFF",
          }}
        >
          + New investigation
        </Link>
      </div>
    </>
  );
}
