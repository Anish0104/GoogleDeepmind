// OWNER: Dev 3. Test fixtures for the warehouse eval: tiny fake answer keys (no real data).
import type { CameraId } from "@/lib/types";
import { TruthSchema, type Truth } from "@/scripts/eval/truth";

/** A 10 s clip; the worker is visible on `visibleOn` cameras, except on `hiddenFrom` cameras in `hidden`. */
export function fakeTruth(o: {
  sceneId: string;
  outcome: "contact" | "near_miss";
  contact?: [number, number] | null;
  minGapT?: number;
  dodgeStartT?: number | null;
  forkliftStopT?: number | null;
  near?: [number, number] | null;
  visibleOn?: CameraId[];
  hidden?: [number, number];
  hiddenFrom?: CameraId[];
  omit?: ("forkliftStopT" | "near" | "dodgeStartT")[];
}): Truth {
  const visibleOn = o.visibleOn ?? ["A", "B", "C", "D"];
  const slices = Array.from({ length: 20 }, (_, i) => {
    const t = i * 0.5;
    const inHidden = o.hidden && t < o.hidden[1] && o.hidden[0] < t + 0.5;
    const cameras: Truth["slices"][number]["cameras"] = {};
    for (const c of ["A", "B", "C", "D"] as CameraId[]) {
      const sees = visibleOn.includes(c) && !(inHidden && (o.hiddenFrom ?? []).includes(c));
      cameras[c] = { "worker:visible:yes": sees ? "yes" : "no", "forklift:visible:yes": "yes" };
    }
    return { t, window: [Math.max(0, t - 0.5), t + 1.5] as [number, number], answers: {}, cameras };
  });
  const summary: Record<string, unknown> = {
    durationS: 10,
    outcome: o.outcome,
    contact: o.contact ?? null,
    minGapM: o.outcome === "contact" ? 0 : 0.6,
    minGapT: o.minGapT,
    near: o.near ?? [2, 8],
    dodgeStartT: o.dodgeStartT ?? null,
    forkliftStopT: o.forkliftStopT ?? null,
  };
  for (const k of o.omit ?? []) delete summary[k];
  return TruthSchema.parse({ sceneId: o.sceneId, presynced: true, summary, slices });
}

