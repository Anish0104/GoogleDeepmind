// OWNER: Dev 4. One camera tile: a procedural render of that camera's view at the replay
// clock. Excluded cameras desaturate with an overlay; the camera an agent is inspecting
// takes the agent's color and loops the inspected window.
"use client";

import { useRef } from "react";
import type { CameraId } from "@/lib/types";
import { drawCam, makeNoise } from "@/components/canvas/drawCam";
import { winTxt } from "@/components/canvas/math";
import { type ReplayTimeline, inspectAt } from "@/components/replay/timeline";
import { useCanvasLoop } from "@/components/site/useCanvasLoop";
import { AGENT_COLOR } from "./verdictStyle";

let noise: HTMLCanvasElement | null = null;
/** Shared film-noise texture, made once per page. */
export function sharedNoise(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  noise ??= makeNoise();
  return noise;
}

export function CameraTile({
  camera,
  excluded,
  T,
  tRef,
  timeline,
  onToggle,
}: {
  camera: CameraId;
  excluded: boolean;
  T: number;
  tRef: { current: number };
  timeline: ReplayTimeline | null;
  onToggle?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const foot = timeline?.foot ?? 22;

  useCanvasLoop(ref, (ctx, w, h, time) => {
    const now = tRef.current;
    const ins = timeline ? inspectAt(timeline, now) : null;
    let t = Math.min(now, foot);
    let hl: string | null = null;
    if (ins && ins.camera === camera && ins.window && !excluded) {
      const span = Math.max(0.5, ins.window[1] - ins.window[0]);
      t = ins.window[0] + (((now - ins.at) * 1.4) % span);
      hl = AGENT_COLOR[ins.step.agent];
    }
    drawCam(ctx, w, h, { id: camera, t, off: excluded, time, highlight: hl, noise: sharedNoise() });
  });

  const ins = timeline ? inspectAt(timeline, T) : null;
  const inspecting = !!(ins && ins.camera === camera && !excluded);
  const ac = inspecting && ins ? AGENT_COLOR[ins.step.agent] : "#7CC7FF";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={excluded}
      aria-label={`Camera ${camera}${excluded ? ", excluded. Click to include" : ". Click to exclude"}`}
      data-testid={`camera-${camera}`}
      className="rs-hover-border"
      style={{
        position: "relative",
        aspectRatio: "16/9",
        padding: 0,
        border: `1px solid ${inspecting ? ac : "rgba(236,230,218,0.1)"}`,
        borderRadius: 14,
        overflow: "hidden",
        background: "#000",
        cursor: "pointer",
        boxShadow: inspecting ? `0 0 0 1px ${ac}, 0 0 48px ${ac}44` : "none",
        transition: "box-shadow .3s cubic-bezier(.22,1,.36,1),border-color .3s cubic-bezier(.22,1,.36,1)",
      }}
    >
      <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      {inspecting && ins && ins.window && (
        <div
          className="rs-mono"
          style={{ position: "absolute", left: 10, bottom: 10, padding: "5px 10px", borderRadius: 6, background: "rgba(6,7,9,0.8)", border: `1px solid ${ac}`, color: ac, fontSize: 12, letterSpacing: "0.04em" }}
        >
          {ins.step.agent.toUpperCase()} · inspect {winTxt(ins.window)} ({ins.crop})
        </div>
      )}
      {excluded && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(6,7,9,0.55)" }}>
          <span className="rs-mono" style={{ fontSize: 13, letterSpacing: "0.22em", color: "#ECE6DA" }}>EXCLUDED</span>
          <span style={{ fontSize: 12, color: "#8A9099" }}>click to include</span>
        </div>
      )}
    </button>
  );
}
