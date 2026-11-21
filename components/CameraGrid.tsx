// OWNER: Dev 4. Operator view: the four camera tiles. Click a tile to exclude/include that
// camera (the operator toggle from the brief). An excluded camera greys out and its grid
// rows dim. In live mode onExcludedChange tells the pipeline to re-run verdict() without
// that camera; in replay it only updates the view.
"use client";

import type { CameraId } from "@/lib/types";
import type { ReplayTimeline } from "@/components/replay/timeline";
import { CameraTile } from "./CameraTile";

/** Toggle one camera in an excluded list. */
export function toggleCamera(excluded: CameraId[], cam: CameraId): CameraId[] {
  return excluded.includes(cam) ? excluded.filter((c) => c !== cam) : [...excluded, cam];
}

export function CameraGrid({
  cameras,
  excluded,
  setExcluded,
  onExcludedChange,
  T,
  tRef,
  timeline,
}: {
  cameras: CameraId[];
  excluded: CameraId[];
  setExcluded: (next: CameraId[]) => void;
  onExcludedChange?: (excluded: CameraId[]) => void;
  T: number;
  tRef: { current: number };
  timeline: ReplayTimeline | null;
}) {
  const cams = cameras.length ? cameras : (["A", "B", "C", "D"] as CameraId[]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
      {cams.map((cam) => (
        <CameraTile
          key={cam}
          camera={cam}
          excluded={excluded.includes(cam)}
          T={T}
          tRef={tRef}
          timeline={timeline}
          onToggle={() => {
            const next = toggleCamera(excluded, cam);
            setExcluded(next);
            onExcludedChange?.(next);
          }}
        />
      ))}
    </div>
  );
}
