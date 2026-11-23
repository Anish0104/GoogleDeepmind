"use client";

import { useState } from "react";
import { useTheme } from "./ThemeContext";

export function ThemeToggle({
  size = 36,
  showLabel = false,
}: {
  size?: number;
  showLabel?: boolean;
}) {
  const { theme, toggleTheme, isMounted } = useTheme();
  const [pulsing, setPulsing] = useState(false);

  const isDark = !isMounted || theme === "dark";

  const handleClick = () => {
    setPulsing(true);
    toggleTheme();
    setTimeout(() => setPulsing(false), 600);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isDark ? "Switch to White Mode (Shift+D)" : "Switch to Dark Mode (Shift+D)"}
      title={isDark ? "Switch to White Mode [Shift+D]" : "Switch to Dark Mode [Shift+D]"}
      className="rs-theme-toggle"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        height: size,
        minWidth: size,
        padding: showLabel ? "0 12px" : 0,
        borderRadius: 999,
        background: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)",
        border: `1px solid ${isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)"}`,
        color: isDark ? "#FAF8F5" : "#0A0C10",
        cursor: "pointer",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        overflow: "hidden",
      }}
    >
      {/* Ripple wave on toggle */}
      {pulsing && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: -10,
            borderRadius: "50%",
            background: isDark
              ? "radial-gradient(circle, rgba(16, 185, 129, 0.4) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(245, 158, 11, 0.4) 0%, transparent 70%)",
            animation: "rsPulse 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Sun / Moon Animated Glyphs */}
      <div
        style={{
          position: "relative",
          width: 18,
          height: 18,
          transform: isDark ? "rotate(0deg)" : "rotate(180deg)",
          transition: "transform 0.65s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* Moon Icon (Dark Mode) */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            inset: 0,
            opacity: isDark ? 1 : 0,
            transform: isDark ? "scale(1) rotate(0deg)" : "scale(0.4) rotate(-90deg)",
            transition: "opacity 0.4s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
            color: "#34D399",
            filter: "drop-shadow(0 0 6px rgba(52, 211, 153, 0.5))",
          }}
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>

        {/* Sun Icon (Light Mode) */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            inset: 0,
            opacity: isDark ? 0 : 1,
            transform: isDark ? "scale(0.4) rotate(90deg)" : "scale(1) rotate(0deg)",
            transition: "opacity 0.4s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
            color: "#D97706",
            filter: "drop-shadow(0 0 6px rgba(217, 119, 6, 0.4))",
          }}
        >
          <circle cx="12" cy="12" r="4" fill="#F59E0B" stroke="#D97706" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      </div>

      {showLabel && (
        <span
          className="rs-mono"
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: isDark ? "#94A3B8" : "#475569",
          }}
        >
          {isDark ? "White" : "Dark"}
        </span>
      )}
    </button>
  );
}
