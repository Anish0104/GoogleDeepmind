// OWNER: Dev 4. The evidence grid card: per-camera pYes over time on a canvas. Brightness is
// pVisible, so blind spots read as blind spots, not low answers.
"use client";

import { useRef } from "react";
import type { CameraId, Claim, GridRow, Question } from "@/lib/types";
import { GRID_GROUP_H, drawGrid, gridQuestions, sliceWidth } from "@/components/canvas/drawGrid";
import { useCanvasLoop } from "@/components/site/useCanvasLoop";

export function Grid({
  grid,
  cameras,
  questions,
  claims = [],
  excluded = [],
  foot,
  tRef,
}: {
  grid: GridRow[];
  cameras: CameraId[];
  questions: Question[];
  claims?: Claim[];
  excluded?: CameraId[];
  foot: number;
  tRef: { current: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const groups = Math.max(1, gridQuestions(grid, questions).length);
  const height = grid.length ? Math.max(150, groups * GRID_GROUP_H) : 40;
  useCanvasLoop(ref, (ctx, w, h) =>
    drawGrid(ctx, w, h, { grid, questions, cameras, excluded, claims, foot, T: tRef.current }),
  );
  return (
    <div className="rs-card" style={{ borderRadius: 16, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Evidence grid</h2>
        <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>
          pYes per camera · {sliceWidth(grid)}s slices · brightness = pVisible
        </span>
      </div>
      <canvas
        ref={ref}
        role="img"
        aria-label={`Evidence grid: ${groups} questions × ${cameras.length} cameras`}
        style={{ width: "100%", height, display: "block", marginTop: 12 }}
      />
      <div className="rs-mono" style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#7D838C", flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 28, height: 6, borderRadius: 3, background: "linear-gradient(90deg,#FF5A47,#FFC23D,#5BE49B)" }} />
          pYes 0 → 1
        </span>
        <span>gemini-decision-1</span>
      </div>
    </div>
  );
}
