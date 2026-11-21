// OWNER: Dev 4. Plays one evidence clip. Real clips are served from
// public/clips/<sceneId>/<clipId>.webm; when a clip is not in the bundle the player falls
// back to the procedural render of that camera's window, labelled as such.
"use client";

import { useRef, useState } from "react";
import type { Evidence } from "@/lib/types";
import { drawCam } from "@/components/canvas/drawCam";
import { winTxt } from "@/components/canvas/math";
import { sharedNoise } from "@/components/CameraTile";
import { useCanvasLoop } from "@/components/site/useCanvasLoop";
import { clipSrc } from "./format";

function RenderFallback({ e }: { e: Evidence }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvasLoop(ref, (ctx, w, h, time) => {
    const span = Math.max(1, e.window[1] - e.window[0]);
    drawCam(ctx, w, h, { id: e.camera, t: e.window[0] + (time % span), off: false, time, noise: sharedNoise() });
  });
  return <canvas ref={ref} aria-label={`Render of camera ${e.camera}, ${winTxt(e.window)}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}

export function ClipPlayer({
  sceneId,
  evidence,
  selected,
  onSelect,
}: {
  sceneId: string;
  evidence: Evidence[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  const e = evidence[selected] ?? evidence[0];
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  if (!e) {
    return (
      <div className="rs-card" style={{ marginTop: 32, borderRadius: 18, padding: 24, fontSize: 13, color: "#7D838C" }}>
        No evidence clips for this claim.
      </div>
    );
  }
  const isFallback = failed[e.clipId] ?? false;
  return (
    <div style={{ marginTop: 32, border: "1px solid rgba(236,230,218,0.09)", borderRadius: 18, overflow: "hidden", background: "#000" }}>
      <div style={{ position: "relative", aspectRatio: "16/9" }}>
        {isFallback ? (
          <RenderFallback key={e.clipId} e={e} />
        ) : (
          <video
            key={e.clipId}
            src={clipSrc(sceneId, e.clipId)}
            autoPlay
            loop
            muted
            playsInline
            controls
            onError={() => setFailed((f) => ({ ...f, [e.clipId]: true }))}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid rgba(236,230,218,0.08)", flexWrap: "wrap" }}>
        <span className="rs-mono" style={{ fontSize: 12, color: "#9AA0A8" }}>
          {e.clipId} · CAM {e.camera} · {winTxt(e.window)} · {isFallback ? "render (clip not in this bundle)" : "looping"}
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {evidence.map((x, i) => {
            const on = i === selected;
            return (
              <button
                key={x.clipId + i}
                type="button"
                onClick={() => onSelect(i)}
                aria-pressed={on}
                className="rs-mono"
                style={{ background: on ? "#ECE6DA" : "transparent", color: on ? "#060709" : "#ECE6DA", border: "1px solid rgba(236,230,218,0.2)", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: "pointer" }}
              >
                ▶ {x.camera} {winTxt(x.window)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
