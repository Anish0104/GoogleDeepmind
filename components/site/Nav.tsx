// OWNER: Dev 4. Apple-style global navigation: translucent frosted glass,
// minimalist typography, active tab indicators, theme switch and pill CTA.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_ITEMS, navIndex } from "./routes";
import { useTheme } from "./ThemeContext";
import { ThemeToggle } from "./ThemeToggle";

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
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <>
      <nav
        aria-label="Global"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 100,
          background: isDark
            ? scrolled
              ? "rgba(0,0,0,0.85)"
              : "rgba(0,0,0,0.72)"
            : scrolled
              ? "rgba(255,255,255,0.88)"
              : "rgba(255,255,255,0.8)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`,
          boxShadow: scrolled
            ? isDark
              ? "0 4px 20px rgba(0,0,0,0.4)"
              : "0 4px 20px rgba(0,0,0,0.04)"
            : "none",
          transition: "background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
        }}
      >
        <div
          style={{
            maxWidth: 1040,
            margin: "0 auto",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 22px",
            boxSizing: "border-box",
          }}
        >
          {/* Brand */}
          <Link
            href="/"
            aria-label="PRISM home"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: isDark ? "#F5F5F7" : "#1D1D1F",
              transition: "opacity 0.2s ease",
            }}
          >
            <Logo size={18} isDark={isDark} />
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              PRISM
            </span>
          </Link>

          {/* Desktop Global Navigation Links */}
          <div
            className="hidden min-[800px]:flex"
            style={{
              alignItems: "center",
              gap: 32,
              height: "100%",
              position: "relative",
            }}
          >
            {NAV_ITEMS.map((item, i) => {
              const active = i === idx;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    height: "100%",
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    letterSpacing: "-0.01em",
                    color: active ? (isDark ? "#F5F5F7" : "#1D1D1F") : isDark ? "#86868B" : "#86868B",
                    textDecoration: "none",
                    transition: "color 0.2s ease, opacity 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.color = isDark ? "#F5F5F7" : "#1D1D1F";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.color = "#86868B";
                  }}
                >
                  {item.label}
                  {active && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: 2,
                        borderRadius: "2px 2px 0 0",
                        background: isDark ? "#F5F5F7" : "#1D1D1F",
                      }}
                    />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Right Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ThemeToggle size={30} />

            <Link
              href="/new"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                height: 28,
                padding: "0 13px",
                borderRadius: 980,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                background: isDark ? "#FFFFFF" : "#1D1D1F",
                color: isDark ? "#000000" : "#FFFFFF",
                textDecoration: "none",
                transition: "opacity 0.2s ease, transform 0.2s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "0.85";
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

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="flex min-[800px]:hidden"
              style={{
                position: "relative",
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              <div style={{ width: 16, height: 12, position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: menuOpen ? 5 : 1,
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
                    bottom: menuOpen ? 5 : 1,
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
        className="min-[800px]:hidden"
        aria-hidden={!menuOpen}
        style={{
          position: "fixed",
          inset: 0,
          top: 48,
          zIndex: 99,
          background: isDark ? "rgba(0,0,0,0.92)" : "rgba(255,255,255,0.92)",
          backdropFilter: "saturate(180%) blur(24px)",
          WebkitBackdropFilter: "saturate(180%) blur(24px)",
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
          transition: "opacity 0.3s ease",
          display: "flex",
          flexDirection: "column",
          padding: "32px 24px 48px",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
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
                  fontSize: 24,
                  fontWeight: active ? 600 : 400,
                  letterSpacing: "-0.02em",
                  color: active ? (isDark ? "#FFFFFF" : "#000000") : "var(--text-muted)",
                  textDecoration: "none",
                  borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}`,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <Link
          href="/new"
          tabIndex={menuOpen ? 0 : -1}
          onClick={() => setMenuOpen(false)}
          style={{
            marginTop: 24,
            padding: "14px 24px",
            fontSize: 14,
            fontWeight: 500,
            borderRadius: 980,
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
