// OWNER: Dev 4. The cinematic shell around the design routes: cursor glow, nav and film
// grain. Other routes (/phone, /label) render untouched.
"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { Nav } from "./Nav";
import { isSitePath } from "./routes";
import { useTheme } from "./ThemeContext";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (ref.current) ref.current.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: 560,
        height: 560,
        margin: "-280px 0 0 -280px",
        borderRadius: "50%",
        background:
          theme === "light"
            ? "radial-gradient(circle, rgba(16, 185, 129, 0.08), rgba(56, 189, 248, 0.04) 40%, rgba(16, 185, 129, 0) 70%)"
            : "radial-gradient(circle, rgba(16, 185, 129, 0.09), rgba(52, 211, 153, 0.03) 40%, rgba(16, 185, 129, 0) 70%)",
        pointerEvents: "none",
        zIndex: 1,
        transform: "translate(-999px,-999px)",
        transition: "background 0.5s ease",
      }}
    />
  );
}

export function SiteChrome({ children, filmGrain = true }: { children: ReactNode; filmGrain?: boolean }) {
  const pathname = usePathname();
  const { theme } = useTheme();
  if (!isSitePath(pathname)) return <>{children}</>;
  return (
    <div
      data-site=""
      className="font-sans"
      style={{
        position: "relative",
        minHeight: "100vh",
        background: "var(--bg-page)",
        color: "var(--text-ink)",
        transition: "background-color 0.4s cubic-bezier(0.22,1,0.36,1), color 0.4s cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <CursorGlow />
      <Nav />
      {children}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          pointerEvents: "none",
          opacity: filmGrain ? (theme === "light" ? 0.06 : 0.12) : 0,
          mixBlendMode: "overlay",
          backgroundImage: GRAIN,
          transition: "opacity 0.4s ease",
        }}
      />
    </div>
  );
}
