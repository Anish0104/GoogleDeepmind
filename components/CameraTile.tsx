// OWNER: Dev 4. One camera tile. Excluded cameras render gray and labelled.
import type { CameraId } from "@/lib/types";

export function CameraTile({ camera, excluded }: { camera: CameraId; excluded: boolean }) {
  return (
    <div
      className={[
        "relative aspect-video rounded-lg border flex items-center justify-center",
        excluded
          ? "border-neutral-300 bg-neutral-200 text-neutral-400"
          : "border-neutral-800 bg-neutral-900 text-neutral-300",
      ].join(" ")}
      data-testid={`camera-${camera}`}
    >
      <span className="absolute left-2 top-2 text-xs font-mono">CAM {camera}</span>
      <span className="text-sm">{excluded ? "excluded" : "● live"}</span>
    </div>
  );
}
