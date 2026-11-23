// OWNER: Dev 4. Scroll-driven word-by-word kinetic illumination for the tagline.
// Scrubs smoothly with viewport scroll position: words rise, de-blur, and light up
// with luminous optical glow (Wispr Flow / Apple grade).
"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/site/ThemeContext";

const WORDS = [
  "Many",
  "angles",
  "on",
  "one",
  "moment.",
  "Each",
  "claim",
  "gets",
  "the",
  "label",
  "the",
  "footage",
  "mathematically",
  "proves,",
  "and",
  "never",
  "a",
  "verdict",
  "on",
  "the",
  "person.",
];

export function TaglineReveal() {
  const containerRef = useRef<HTMLParagraphElement>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let ticking = false;
    const update = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const windowH = window.innerHeight;

      // Starts illuminating as the top enters around 85% from the top of viewport,
      // completes when it reaches around 35% of the viewport.
      const start = windowH * 0.85;
      const end = windowH * 0.35;
      const current = Math.max(0, Math.min(1, (start - rect.top) / (start - end)));
      setProgress(current);
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section
      style={{
        position: "relative",
        zIndex: 2,
        padding: "clamp(80px,14vh,160px) clamp(20px,5vw,72px)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <p
        ref={containerRef}
        className="rs-serif"
        style={{
          margin: 0,
          maxWidth: 780,
          fontSize: "clamp(34px,4.8vw,60px)",
          lineHeight: 1.25,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          display: "flex",
          flexWrap: "wrap",
          columnGap: "0.28em",
          rowGap: 10,
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {WORDS.map((w, i) => {
          const wordStep = 1 / WORDS.length;
          const wordStart = i * wordStep * 0.85;
          const wordEnd = wordStart + wordStep * 1.5;

          // Normalized 0 to 1 illumination for this word
          const wordProgress = Math.max(0, Math.min(1, (progress - wordStart) / (wordEnd - wordStart)));

          const isHighlight = w.includes("proves") || w.includes("mathematically");
          const isPerson = w.includes("person") || w.includes("verdict");

          const opacity = 0.2 + wordProgress * 0.8;

          let activeColor = isDark ? "#FFFFFF" : "#0A0C10";
          if (isHighlight && wordProgress > 0.4) activeColor = isDark ? "#34D399" : "#059669";
          if (isPerson && wordProgress > 0.6) activeColor = isDark ? "#FAF8F5" : "#1E293B";

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                color: activeColor,
                opacity,
                filter: wordProgress > 0.85 ? "blur(0px)" : `blur(${(1 - wordProgress) * 0.8}px)`,
                transform: `translateY(${(1 - wordProgress) * 4}px)`,
                transition: "color 0.2s ease, opacity 0.15s ease, transform 0.2s ease, filter 0.2s ease",
                textShadow:
                  wordProgress > 0.85
                    ? isHighlight
                      ? "0 0 24px rgba(52, 211, 153, 0.45)"
                      : isDark
                        ? "0 0 20px rgba(255,255,255,0.22)"
                        : "none"
                    : "none",
                fontStyle: isPerson ? "italic" : "normal",
              }}
            >
              {w}
            </span>
          );
        })}
      </p>
    </section>
  );
}
