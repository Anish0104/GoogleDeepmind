// OWNER: Dev 4. Operator view: camera tiles + live grid, sharing one "excluded" state.
// Click a tile to exclude/include that camera (the operator toggle from the brief). An
// excluded camera greys out and its grid rows dim. In live mode this also tells the
// pipeline to re-run verdict() without that camera; in replay it updates the view.
"use client";

import { useState } from "react";
import type { CameraId, GridRow, Question } from "@/lib/types";
import { Grid } from "./Grid";

export function CameraGrid({
  cameras,
  excludedInit,
  grid,
  questions,
  onExcludedChange,
}: {
  cameras: CameraId[];
  excludedInit: CameraId[];
  grid: GridRow[];
  questions: Question[];
  onExcludedChange?: (excluded: CameraId[]) => void;
}) {
  const [excluded, setExcluded] = useState<CameraId[]>(excludedInit);

  function toggle(cam: CameraId) {
    setExcluded((prev) => {
      const next = prev.includes(cam) ? prev.filter((c) => c !== cam) : [...prev, cam];
      onExcludedChange?.(next);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-neutral-500">Cameras</h2>
          <span className="text-xs text-neutral-400">
            {excluded.length > 0 ? `${excluded.length} excluded` : "click a tile to exclude"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cameras.map((cam) => {
            const off = excluded.includes(cam);
            return (
              <button
                key={cam}
                type="button"
                onClick={() => toggle(cam)}
                aria-pressed={off}
                className={[
                  "relative aspect-video rounded-lg border text-left transition",
                  off
                    ? "border-neutral-300 bg-neutral-200 text-neutral-400"
                    : "border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600",
                ].join(" ")}
                data-testid={`camera-${cam}`}
                title={off ? "excluded — click to include" : "click to exclude"}
              >
                <span className="absolute left-2 top-2 font-mono text-xs">CAM {cam}</span>
                <span className="absolute inset-0 flex items-center justify-center text-sm">
                  {off ? "excluded" : "● live"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Grid</h2>
        <Grid grid={grid} cameras={cameras} questions={questions} excluded={excluded} />
      </div>
    </div>
  );
}
