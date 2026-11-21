// OWNER: Dev 4. The cost meter: spent vs the hard stop. Turns red and shows "stopped"
// once the budget is hit (live this comes from /api/cost; in replay it's summed steps).
import { LIMITS } from "@/lib/config";

export function CostMeter({
  spentUsd,
  hardStopUsd = LIMITS.BUDGET_HARD_STOP_USD,
}: {
  spentUsd: number;
  hardStopUsd?: number;
}) {
  const blocked = spentUsd >= hardStopUsd;
  const pct = Math.min(100, hardStopUsd > 0 ? (spentUsd / hardStopUsd) * 100 : 0);
  return (
    <div className="w-56">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono text-neutral-700">
          ${spentUsd.toFixed(2)} / ${hardStopUsd.toFixed(2)}
        </span>
        {blocked && <span className="font-medium text-red-600">stopped</span>}
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200">
        <div
          className={blocked ? "h-full bg-red-500" : "h-full bg-neutral-800"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
