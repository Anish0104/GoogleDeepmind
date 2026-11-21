// OWNER: Dev 4. The cost meter: agent spend vs the hard stop. Turns red and shows "stopped"
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
    <div style={{ width: 220 }}>
      <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: blocked ? "#FF5A47" : "#7D838C" }}>{blocked ? "stopped" : "agent spend"}</span>
        <span>
          ${spentUsd.toFixed(2)} / ${hardStopUsd.toFixed(2)}
        </span>
      </div>
      <div style={{ marginTop: 6, height: 4, borderRadius: 4, background: "rgba(236,230,218,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: blocked ? "#FF5A47" : "#ECE6DA" }} />
      </div>
    </div>
  );
}
