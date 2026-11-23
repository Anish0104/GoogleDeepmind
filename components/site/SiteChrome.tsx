// OWNER: Dev 4. The cinematic shell around the design routes: cursor glow, nav and film
// grain. Other routes (/phone, /label) render untouched.
"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { Nav } from "./Nav";
import { isSitePath } from "./routes";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
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
        background: "radial-gradient(circle, rgba(16, 185, 129, 0.09), rgba(52, 211, 153, 0.03) 40%, rgba(16, 185, 129, 0) 70%)",
        pointerEvents: "none",
        zIndex: 1,
        transform: "translate(-999px,-999px)",
      }}
    />
  );
}

export function SiteChrome({ children, filmGrain = true }: { children: ReactNode; filmGrain?: boolean }) {
  const pathname = usePathname();
  if (!isSitePath(pathname)) return <>{children}</>;
  return (
    <div data-site="" className="font-sans" style={{ position: "relative", minHeight: "100vh", background: "#08090B", color: "#FAF8F5" }}>
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
          opacity: filmGrain ? 0.12 : 0,
          mixBlendMode: "overlay",
          backgroundImage: GRAIN,
        }}
      />
    </div>
  );
}
