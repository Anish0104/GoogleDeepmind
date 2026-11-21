// OWNER: Dev 4. One requestAnimationFrame loop per canvas. The canvas backing store is
// sized to clientWidth*dpr × clientHeight*dpr (dpr capped at 2) every frame.
"use client";

import { type RefObject, useEffect, useRef } from "react";

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => void;

interface Fittable {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}

/** Size a canvas for the device pixel ratio. Returns [ctx, cssWidth, cssHeight] or null when hidden. */
export function fitCanvas(
  el: Fittable | null,
  devicePixelRatio = 1,
): [CanvasRenderingContext2D, number, number] | null {
  if (!el) return null;
  const d = Math.min(devicePixelRatio || 1, 2);
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return null;
  if (el.width !== Math.round(w * d) || el.height !== Math.round(h * d)) {
    el.width = Math.round(w * d);
    el.height = Math.round(h * d);
  }
  const ctx = el.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return [ctx, w, h];
}

export function useCanvasLoop(ref: RefObject<HTMLCanvasElement | null>, draw: DrawFn): void {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    let raf = 0;
    let warned = false;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const f = fitCanvas(ref.current, window.devicePixelRatio);
      if (!f) return;
      try {
        drawRef.current(f[0], f[1], f[2], now / 1000);
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn(err);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}
