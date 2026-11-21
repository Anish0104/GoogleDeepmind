// OWNER: Dev 4. Replay transport: play/pause, timecode, phase, and a draggable scrubber
// showing claim bands, agent step ticks and the agent zone.
"use client";

import { useEffect, useRef } from "react";
import type { Claim } from "@/lib/types";
import { fmt, pct } from "@/components/canvas/math";
import { type ReplayTimeline, verdictAt } from "@/components/replay/timeline";
import { AGENT_COLOR, verdictStyle } from "./verdictStyle";
import type { ClaimResult } from "@/lib/types";

export function phaseOf(T: number, foot: number, end: number): { label: string; color: string } {
  if (T < foot) return { label: "FOOTAGE PASS", color: "#9AA0A8" };
  if (T < end) return { label: "AGENTS RUNNING", color: "#B79CFF" };
  return { label: "COMPLETE", color: "#5BE49B" };
}

export function Transport({
  T,
  playing,
  timeline,
  claims,
  results,
  togglePlay,
  restart,
  seek,
}: {
  T: number;
  playing: boolean;
  timeline: ReplayTimeline;
  claims: Claim[];
  results: ClaimResult[];
  togglePlay: () => void;
  restart: () => void;
  seek: (t: number) => void;
}) {
  const { foot, end, steps } = timeline;
  const scrub = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const phase = phaseOf(T, foot, end);
  const finalBy = new Map(results.map((r) => [r.claimId, r.verdict]));

  const seekX = (x: number) => {
    const el = scrub.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    seek(((x - r.left) / r.width) * end);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current) seekX(e.clientX);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  return (
    <div className="rs-card" style={{ borderRadius: 16, padding: "14px 18px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="rs-btn rs-btn-primary"
          style={{ width: 40, height: 40, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {playing ? (
            <span style={{ display: "flex", gap: 4 }}>
              <span style={{ width: 4, height: 13, background: "#000", borderRadius: 1 }} />
              <span style={{ width: 4, height: 13, background: "#000", borderRadius: 1 }} />
            </span>
          ) : (
            <span style={{ width: 0, height: 0, marginLeft: 3, borderLeft: "11px solid #060709", borderTop: "7px solid transparent", borderBottom: "7px solid transparent" }} />
          )}
        </button>
        <div className="rs-mono" style={{ fontSize: 20, letterSpacing: "0.02em", minWidth: 120 }}>
          {T <= foot ? fmt(T) : `+${(T - foot).toFixed(1)}s`}
        </div>
        <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.1em", color: phase.color }}>
          {phase.label}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={restart} className="rs-btn rs-btn-line" style={{ color: "#9AA0A8", padding: "6px 12px", fontSize: 12 }}>
          ↺ Replay
        </button>
      </div>
      <div
        ref={scrub}
        role="slider"
        tabIndex={0}
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={end}
        aria-valuenow={Math.round(T * 10) / 10}
        onPointerDown={(e) => {
          dragging.current = true;
          seekX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(T + 0.5);
          if (e.key === "ArrowLeft") seek(T - 0.5);
        }}
        style={{ position: "relative", height: 54, marginTop: 14, cursor: "pointer", userSelect: "none", touchAction: "none" }}
      >
        <div
          style={{
            position: "absolute",
            left: pct(foot / end),
            right: 0,
            top: 0,
            bottom: 0,
            borderRadius: 6,
            background: "repeating-linear-gradient(135deg,rgba(183,156,255,0.07) 0 6px,rgba(183,156,255,0.02) 6px 12px)",
            border: "1px dashed rgba(183,156,255,0.25)",
          }}
        />
        <div className="rs-mono" style={{ position: "absolute", left: `calc(${pct(foot / end)} + 6px)`, top: 3, fontSize: 11, letterSpacing: "0.12em", color: "#B79CFF" }}>
          AGENTS
        </div>
        {claims.map((c, i) => {
          const v = finalBy.get(c.id);
          return (
            <div
              key={c.id}
              title={`${c.id} · ${c.text}`}
              style={{
                position: "absolute",
                left: pct(c.window[0] / end),
                width: pct((Math.min(c.window[1], foot) - c.window[0]) / end),
                top: 10 + (i % 4) * 10,
                height: 8,
                borderRadius: 4,
                background: v ? verdictStyle(v).color : "#7D838C",
                opacity: verdictAt(timeline, c.id, T) ? 0.9 : 0.25,
                transition: "opacity .4s cubic-bezier(.22,1,.36,1)",
              }}
            />
          );
        })}
        {steps.map((s) => (
          <div
            key={s.index}
            style={{
              position: "absolute",
              left: pct(s.at / end),
              top: 18,
              width: 2,
              height: 20,
              marginLeft: -1,
              borderRadius: 2,
              background: T >= s.at ? (s.step.action === "rejected" ? "#FF5A47" : AGENT_COLOR[s.step.agent]) : "rgba(236,230,218,0.2)",
            }}
          />
        ))}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 4, height: 2, background: "rgba(236,230,218,0.1)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: 0, width: pct(T / end), bottom: 4, height: 2, background: "#ECE6DA", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: pct(T / end), top: -4, bottom: 0, width: 2, marginLeft: -1, background: "#ECE6DA", boxShadow: "0 0 12px #ECE6DA" }}>
          <div style={{ position: "absolute", left: -5, bottom: -1, width: 12, height: 12, borderRadius: "50%", background: "#ECE6DA" }} />
        </div>
      </div>
    </div>
  );
}
