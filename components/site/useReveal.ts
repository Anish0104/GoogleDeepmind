// OWNER: Dev 4. Scroll reveals. Blocks marked data-reveal that start below the fold fade up
// once; words marked data-word light up as they cross 42% from the bottom. Both respect
// prefers-reduced-motion.
"use client";

import { type RefObject, useEffect } from "react";

/** Stagger delay for the i-th revealed block, in seconds. */
export function revealDelay(i: number): number {
  return (i % 4) * 0.08;
}

export function useReveal(root: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const words = [...el.querySelectorAll<HTMLElement>("[data-word]")];
    const blocks = [...el.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (reduced || typeof IntersectionObserver === "undefined") {
      words.forEach((w) => (w.style.opacity = "1"));
      return;
    }
    const wio = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).style.opacity = "1";
            wio.unobserve(e.target);
          }
        }),
      { rootMargin: "0px 0px -42% 0px" },
    );
    words.forEach((w) => wio.observe(w));
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            const t = e.target as HTMLElement;
            t.style.opacity = "1";
            t.style.transform = "none";
            io.unobserve(t);
          }
        }),
      { threshold: 0.1 },
    );
    blocks.forEach((b, i) => {
      if (b.getBoundingClientRect().top < window.innerHeight) return;
      const d = revealDelay(i);
      b.style.opacity = "0";
      b.style.transform = "translateY(32px)";
      b.style.transition = `opacity .9s cubic-bezier(.2,.8,.2,1) ${d}s, transform 1s cubic-bezier(.2,.8,.2,1) ${d}s`;
      io.observe(b);
    });
    return () => {
      wio.disconnect();
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
