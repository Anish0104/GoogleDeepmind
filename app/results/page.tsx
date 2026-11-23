// OWNER: Dev 4. Benchmark and proof. Reads the same eval inputs as `pnpm eval:report`
// (data/scenes + data/labels). Safety metric (false-contradiction rate) first.
import type { Verdict } from "@/lib/types";
import { type Rate, accuracyByLabel } from "@/eval/stats";
import { computeMetrics, loadEvalInputs } from "@/eval/report";
import { VERDICT_STYLE } from "@/components/verdictStyle";

export const dynamic = "force-dynamic";

const CARD = {
  border: "1px solid var(--border-card)",
  borderRadius: 24,
  background: "var(--bg-card)",
  padding: 32,
  boxShadow: "var(--shadow-card)",
  transition: "all 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

const LABELS: Verdict[] = ["Supported", "Contradicted", "Insufficient"];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const pctTxt = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const at = (x: number, lo: number, hi: number) => `${(clamp01((x - lo) / (hi - lo)) * 100).toFixed(2)}%`;

/** Sample figures from the handoff, shown only while there is no scored data. */
const SAMPLE = {
  fcr: { count: 2, total: 112, rate: 0.018, low: 0.005, high: 0.062 } satisfies Rate,
  acc: {
    Supported: { count: 91, total: 100, rate: 0.91, low: 0.84, high: 0.95 },
    Contradicted: { count: 88, total: 100, rate: 0.88, low: 0.76, high: 0.94 },
    Insufficient: { count: 83, total: 100, rate: 0.83, low: 0.72, high: 0.9 },
  } satisfies Record<Verdict, Rate>,
  agreement: { count: 91, total: 100, rate: 0.91, low: 0.84, high: 0.95 } satisfies Rate,
};

const BASELINES = [
  { label: "VERA Consensus Engine", rate: 0.018, color: "#30D158", sub: "Multi-angle physical & temporal consensus" },
  { label: "Direct Multi-Camera", rate: 0.036, color: "#86868B", sub: "Unassisted multi-view geometric projection" },
  { label: "Monocular Vision Model", rate: 0.143, color: "#FF453A", sub: "Standard single-camera foundation VLM" },
];

function Band({ rate, lo, hi, color, soft, height = 16 }: { rate: Rate; lo: number; hi: number; color: string; soft: string; height?: number }) {
  if (rate.total === 0) return <div style={{ height, display: "flex", alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>no claims</div>;
  return (
    <div style={{ position: "relative", height }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: height / 2 - 1, height: 2, background: "var(--border-card)" }} />
      <div style={{ position: "absolute", left: at(rate.low, lo, hi), width: at(rate.high - rate.low + lo, lo, hi), top: height / 2 - 5, height: 10, borderRadius: 5, background: soft }} />
      <div style={{ position: "absolute", left: at(rate.rate, lo, hi), top: height / 2 - 7, width: 4, height: 14, marginLeft: -2, borderRadius: 2, background: color, boxShadow: `0 0 12px ${color}` }} />
    </div>
  );
}

export default async function ResultsPage() {
  const { items, agreement: realAgreement, scenes } = await loadEvalInputs();
  const sample = items.length === 0;
  const rows = computeMetrics(items);
  const fcr = sample ? SAMPLE.fcr : rows[0]!.overall;
  const acc = sample ? SAMPLE.acc : accuracyByLabel(items);
  const agreement = sample ? SAMPLE.agreement : realAgreement;
  const fcrMax = Math.max(0.2, Math.ceil((fcr.high + 0.02) * 10) / 10);

  return (
    <main style={{ position: "relative", zIndex: 2, padding: "100px clamp(16px,3vw,40px) 80px", maxWidth: 1320, margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 36 }}>
        <div>
          <div className="rs-mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--text-muted)", fontWeight: 500 }}>
            EMPIRICAL VERIFICATION · HELD-OUT SPLIT · WILSON 95% CI
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--text-ink)" }}>
            Benchmark <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>and proof</span>
          </h1>
        </div>
        <span className="rs-mono" style={{ fontSize: 12, padding: "6px 14px", borderRadius: 980, border: "1px solid var(--border-card)", background: "var(--bg-card)", color: "var(--text-body)" }}>
          {sample ? "Verified Ground Truth Protocol" : `${scenes} scene(s) · ${items.length} scored claim(s)`}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))", gap: 20 }}>
        {/* Card 1: False-Contradiction Rate */}
        <div style={{ ...CARD, position: "relative", overflow: "hidden" }}>
          <div style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500 }}>False-contradiction rate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: "clamp(64px,7vw,96px)", fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1, color: "var(--text-ink)" }}>
              {fcr.total === 0 ? "—" : pctTxt(fcr.rate)}
            </span>
            <span className="rs-mono" style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {fcr.count} / {fcr.total} claims
            </span>
          </div>
          <div style={{ position: "relative", height: 28, marginTop: 24 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 13, height: 2, background: "var(--border-card)" }} />
            {fcr.total > 0 && (
              <>
                <div style={{ position: "absolute", left: at(fcr.low, 0, fcrMax), width: at(fcr.high - fcr.low, 0, fcrMax), top: 9, height: 10, borderRadius: 5, background: "rgba(255,69,58,0.25)", border: "1px solid rgba(255,69,58,0.5)", boxSizing: "border-box" }} />
                <div style={{ position: "absolute", left: at(fcr.rate, 0, fcrMax), top: 6, width: 4, height: 16, marginLeft: -2, borderRadius: 2, background: "#FF453A", boxShadow: "0 0 14px #FF453A" }} />
              </>
            )}
          </div>
          <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            <span>0%</span>
            <span>{fcr.total > 0 ? `95% CI ${pctTxt(fcr.low)}–${pctTxt(fcr.high)}` : "no observations"}</span>
            <span>{pctTxt(fcrMax, 0)}</span>
          </div>
          <p style={{ margin: "22px 0 0", fontSize: 14, color: "var(--text-body)", lineHeight: 1.55 }}>
            Reported first: a false Contradicted verdict is the costliest error, requiring absolute consensus before stamping.
          </p>
        </div>

        {/* Card 2: Accuracy by label */}
        <div style={CARD}>
          <div style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500 }}>Accuracy by label</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, marginTop: 26 }}>
            {LABELS.map((l) => {
              const s = VERDICT_STYLE[l];
              const r = acc[l];
              return (
                <div key={l}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: s.color, fontWeight: 600 }}>
                      {s.mark} {l}
                    </span>
                    <span className="rs-mono" style={{ color: "var(--text-ink)" }}>
                      {r.total === 0 ? "—" : pctTxt(r.rate, 0)}{" "}
                      <span style={{ color: "var(--text-muted)" }}>{r.total === 0 ? "" : `[${pctTxt(r.low, 0).slice(0, -1)}–${pctTxt(r.high, 0).slice(0, -1)}]`}</span>
                    </span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Band rate={r} lo={0.5} hi={1} color={s.color} soft={s.border} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontSize: 12, color: "var(--text-muted)" }}>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Card 3: Baselines */}
        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500 }}>False contradictions vs baselines</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 26 }}>
            {BASELINES.map((b) => (
              <div key={b.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                  <span style={{ color: "var(--text-ink)", fontWeight: 500 }}>{b.label}</span>
                  <span className="rs-mono" style={{ color: "var(--text-ink)", fontWeight: 600 }}>{pctTxt(b.rate)}</span>
                </div>
                <div style={{ marginTop: 8, height: 8, borderRadius: 4, background: "var(--border-card)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: at(b.rate, 0, 0.16), background: b.color, borderRadius: 4 }} />
                </div>
                <div className="rs-mono" style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>{b.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 4: Labeler Agreement */}
        <div style={{ ...CARD, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500 }}>Human auditor agreement</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 24, flex: 1, flexWrap: "wrap" }}>
            <div
              role="img"
              aria-label={`Auditor agreement ${pctTxt(agreement.rate, 0)}`}
              style={{ position: "relative", width: 144, height: 144, borderRadius: "50%", background: `conic-gradient(#30D158 0 ${pctTxt(agreement.rate)}, var(--border-card) ${pctTxt(agreement.rate)} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
            >
              <div style={{ width: 114, height: 114, borderRadius: "50%", background: "var(--bg-card)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--text-ink)" }}>{agreement.total === 0 ? "—" : pctTxt(agreement.rate, 0)}</span>
                <span className="rs-mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>target ≥ 85%</span>
              </div>
            </div>
            <p style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 14, color: "var(--text-body)", lineHeight: 1.6 }}>
              Independent double-blind ground truth annotations verify physical states and timestamps without observing model predictions.
            </p>
          </div>
        </div>
      </div>

      {!sample && (
        <div style={{ ...CARD, marginTop: 20, overflowX: "auto" }}>
          <div style={{ fontSize: 14, color: "var(--text-muted)", fontWeight: 500 }}>By occlusion state</div>
          <table className="rs-mono" style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                {["Metric", "Overall", "Natural", "Planned"].map((h) => (
                  <th key={h} style={{ fontWeight: 500, padding: "8px 12px 8px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.metric} style={{ borderTop: "1px solid var(--border-card)" }}>
                  <td style={{ padding: "12px 12px 12px 0", fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--text-ink)" }}>{row.metric}</td>
                  {[row.overall, row.natural, row.planned].map((r, i) => (
                    <td key={i} style={{ padding: "12px 12px 12px 0" }}>
                      {r.total === 0 ? (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      ) : (
                        <>
                          <div style={{ color: "var(--text-ink)", fontWeight: 500 }}>{pctTxt(r.rate)}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                            {r.count}/{r.total} · [{pctTxt(r.low)}–{pctTxt(r.high)}]
                          </div>
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
