// OWNER: Dev 4. One claim: its text, final label, per-camera evidence with PLAYABLE clips,
// and the full label history (including blocked Skeptic attempts — the safety story).
"use client";

import { useState } from "react";
import type { Claim, ClaimResult, Evidence } from "@/lib/types";
import { verdictStyle } from "./verdictStyle";

/** Clips are served from public/clips/<sceneId>/<clipId>.webm (populated for the demo
 *  backup and by the pipeline). Missing clips fall back to a note, so replay never breaks. */
function clipSrc(sceneId: string, clipId: string): string {
  return `/clips/${sceneId}/${clipId}.webm`;
}

function ClipPlayer({ sceneId, clipId, onClose }: { sceneId: string; clipId: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs text-neutral-500">{clipId}</span>
        <button type="button" onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700">
          close
        </button>
      </div>
      {failed ? (
        <p className="py-3 text-center text-xs text-neutral-400">
          Clip not in this bundle (replay). It plays once {clipId} is recorded under
          <span className="font-mono"> public{clipSrc(sceneId, clipId)}</span>.
        </p>
      ) : (
        <video
          controls
          autoPlay
          className="w-full rounded"
          src={clipSrc(sceneId, clipId)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

export function ClaimRow({ claim, result }: { claim: Claim; result: ClaimResult | undefined }) {
  const style = result ? verdictStyle(result.verdict) : null;
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-neutral-900">&ldquo;{claim.text}&rdquo;</div>
          <div className="mt-0.5 font-mono text-xs text-neutral-400">
            {claim.id} &middot; {claim.window[0]}&ndash;{claim.window[1]}s
            {claim.timeIsPrecise ? "" : " · approx"}
          </div>
        </div>
        {style && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.badge}`}>
            {style.mark} {style.label}
          </span>
        )}
      </div>

      {result && result.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.evidence.map((e: Evidence, i: number) => (
            <button
              key={i}
              type="button"
              onClick={() => setPlaying((p) => (p === e.clipId ? null : e.clipId))}
              aria-pressed={playing === e.clipId}
              className={[
                "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs",
                playing === e.clipId
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100",
              ].join(" ")}
              title={`play clip from camera ${e.camera}, visibility ${e.visible}`}
            >
              <span aria-hidden>{"▶"}</span>
              {e.camera} {e.window[0]}&ndash;{e.window[1]}s
              <span className={playing === e.clipId ? "text-neutral-300" : "text-neutral-400"}>
                {e.source}
              </span>
            </button>
          ))}
        </div>
      )}

      {playing && (
        <ClipPlayer sceneId={claim.sceneId} clipId={playing} onClose={() => setPlaying(null)} />
      )}

      {result && result.history.length > 0 && (
        <ol className="mt-3 space-y-1 border-l-2 border-neutral-100 pl-3">
          {result.history.map((h, i) => (
            <li key={i} className="text-xs text-neutral-500">
              <span className="font-mono text-neutral-400">{h.by}</span>{" "}
              {h.from} {"→"} {h.to}
              {h.blocked && (
                <span className="ml-1 rounded bg-neutral-100 px-1 text-neutral-500">blocked</span>
              )}
              <span className="text-neutral-400"> &mdash; {h.reason}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
