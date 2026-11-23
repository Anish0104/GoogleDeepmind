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
        <span style={{ color: blocked ? "#FF5A47" : "var(--text-muted)" }}>{blocked ? "stopped" : "agent spend"}</span>
        <span style={{ color: "var(--text-body)" }}>
          {spentUsd.toFixed(2)} / {hardStopUsd.toFixed(2)} units
        </span>
      </div>
      <div style={{ marginTop: 6, height: 4, borderRadius: 4, background: "var(--border-card)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: blocked ? "#FF5A47" : "#10B981" }} />
      </div>
    </div>
  );
}
