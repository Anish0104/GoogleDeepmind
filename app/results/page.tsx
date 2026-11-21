// OWNER: Dev 4. Benchmark and proof. Reads the same eval inputs as `pnpm eval:report`
// (data/scenes + data/labels). Safety metric (false-contradiction rate) first. Until there
// are scored claims, the cards show sample figures under a clear "Sample figures" chip.
import type { Verdict } from "@/lib/types";
import { type Rate, accuracyByLabel } from "@/eval/stats";
import { computeMetrics, loadEvalInputs } from "@/eval/report";
import { VERDICT_STYLE } from "@/components/verdictStyle";

export const dynamic = "force-dynamic";

const CARD = { border: "1px solid rgba(236,230,218,0.09)", borderRadius: 20, background: "#131209", padding: 28 } as const;
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
  { label: "RASHOMON", rate: 0.018, color: "#ECE6DA", sub: "verdict() + Investigator + Skeptic" },
  { label: "Agents off", rate: 0.036, color: "#9AA0A8", sub: "verdict() only" },
  { label: "Single-pass model", rate: 0.143, color: "#FF5A47", sub: "gemini-4-neon, one prompt per claim" },
];

function Band({ rate, lo, hi, color, soft, height = 16 }: { rate: Rate; lo: number; hi: number; color: string; soft: string; height?: number }) {
  if (rate.total === 0) return <div style={{ height, display: "flex", alignItems: "center", fontSize: 12, color: "#5E646D" }}>no claims</div>;
  return (
    <div style={{ position: "relative", height }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: height / 2 - 1, height: 2, background: "rgba(236,230,218,0.08)" }} />
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
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 32 }}>
        <div>
          <div className="rs-mono" style={{ fontSize: 12, letterSpacing: "0.14em", color: "#7D838C" }}>
            HELD-OUT SPLIT · ONE SAMPLE PER SCENE · WILSON 95% CI
          </div>
          <h1 style={{ margin: "10px 0 0", fontSize: "clamp(36px,4.4vw,60px)", fontWeight: 500, letterSpacing: "-0.04em", lineHeight: 1 }}>
            Benchmark <span style={{ fontWeight: 400, color: "#9AA0A8" }}>and proof</span>
          </h1>
        </div>
        {sample ? (
          <span className="rs-mono" style={{ fontSize: 12, padding: "6px 12px", borderRadius: 999, border: "1px dashed rgba(255,194,61,0.5)", color: "#FFC23D" }}>
            Sample figures · replace with pnpm eval:report
          </span>
        ) : (
          <span className="rs-mono" style={{ fontSize: 12, padding: "6px 12px", borderRadius: 999, border: "1px solid rgba(91,228,155,0.4)", color: "#5BE49B" }}>
            {scenes} scene(s) · {items.length} scored claim(s)
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,400px),1fr))", gap: 16 }}>
        <div style={{ ...CARD, position: "relative", overflow: "hidden", background: "#181818" }}>
          <div style={{ fontSize: 14, color: "#9AA0A8" }}>False-contradiction rate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "clamp(72px,8vw,112px)", fontWeight: 500, letterSpacing: "-0.05em", lineHeight: 1 }}>
              {fcr.total === 0 ? "—" : pctTxt(fcr.rate)}
            </span>
            <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>
              {fcr.count} / {fcr.total} claims
            </span>
          </div>
          <div style={{ position: "relative", height: 28, marginTop: 24 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 13, height: 2, background: "rgba(236,230,218,0.08)" }} />
            {fcr.total > 0 && (
              <>
                <div style={{ position: "absolute", left: at(fcr.low, 0, fcrMax), width: at(fcr.high - fcr.low, 0, fcrMax), top: 9, height: 10, borderRadius: 5, background: "rgba(255,90,71,0.3)", border: "1px solid rgba(255,90,71,0.6)", boxSizing: "border-box" }} />
                <div style={{ position: "absolute", left: at(fcr.rate, 0, fcrMax), top: 6, width: 4, height: 16, marginLeft: -2, borderRadius: 2, background: "#FF5A47", boxShadow: "0 0 14px #FF5A47" }} />
              </>
            )}
          </div>
          <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#5E646D" }}>
            <span>0%</span>
            <span>{fcr.total > 0 ? `95% CI ${pctTxt(fcr.low)}–${pctTxt(fcr.high)}` : "no observations"}</span>
            <span>{pctTxt(fcrMax, 0)}</span>
          </div>
          <p style={{ margin: "20px 0 0", fontSize: 13, color: "#8A9099", lineHeight: 1.55 }}>
            Reported first: a wrong Contradicted is the costliest mistake, so the label is the hardest to get.
          </p>
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 14, color: "#9AA0A8" }}>Accuracy by label</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 24 }}>
            {LABELS.map((l) => {
              const s = VERDICT_STYLE[l];
              const r = acc[l];
              return (
                <div key={l}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: s.color }}>
                      {s.mark} {l}
                    </span>
                    <span className="rs-mono">
                      {r.total === 0 ? "—" : pctTxt(r.rate, 0)}{" "}
                      <span style={{ color: "#5E646D" }}>{r.total === 0 ? "" : `[${pctTxt(r.low, 0).slice(0, -1)}–${pctTxt(r.high, 0).slice(0, -1)}]`}</span>
                    </span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Band rate={r} lo={0.5} hi={1} color={s.color} soft={s.border} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rs-mono" style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: "#5E646D" }}>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <div style={CARD}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, color: "#9AA0A8" }}>False contradictions vs baselines</span>
            <span className="rs-mono" style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px dashed rgba(255,194,61,0.5)", color: "#FFC23D" }}>
              sample
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 24 }}>
            {BASELINES.map((b) => (
              <div key={b.label}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                  <span>{b.label}</span>
                  <span className="rs-mono">{pctTxt(b.rate)}</span>
                </div>
                <div style={{ marginTop: 8, height: 10, borderRadius: 5, background: "rgba(236,230,218,0.05)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: at(b.rate, 0, 0.16), background: b.color, borderRadius: 5 }} />
                </div>
                <div className="rs-mono" style={{ marginTop: 5, fontSize: 12, color: "#5E646D" }}>{b.sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...CARD, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 14, color: "#9AA0A8" }}>Labeler agreement</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 20, flex: 1, flexWrap: "wrap" }}>
            <div
              role="img"
              aria-label={`Labeler agreement ${pctTxt(agreement.rate, 0)}`}
              style={{ position: "relative", width: 150, height: 150, borderRadius: "50%", background: `conic-gradient(#5BE49B 0 ${pctTxt(agreement.rate)},rgba(236,230,218,0.07) ${pctTxt(agreement.rate)} 100%)`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
            >
              <div style={{ width: 122, height: 122, borderRadius: "50%", background: "#131209", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-0.03em" }}>{agreement.total === 0 ? "—" : pctTxt(agreement.rate, 0)}</span>
                <span className="rs-mono" style={{ fontSize: 12, color: "#7D838C" }}>target ≥ 85%</span>
              </div>
            </div>
            <p style={{ margin: 0, flex: 1, minWidth: 180, fontSize: 14, color: "#9AA0A8", lineHeight: 1.6 }}>
              Two labelers mark what actually happened in <a href="/label" className="rs-mono">/label</a> and label each claim from the footage. They never see system output.
            </p>
          </div>
        </div>
      </div>

      {!sample && (
        <div style={{ ...CARD, marginTop: 16, overflowX: "auto" }}>
          <div style={{ fontSize: 14, color: "#9AA0A8" }}>By occlusion</div>
          <table className="rs-mono" style={{ width: "100%", marginTop: 16, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "#7D838C", textAlign: "left" }}>
                {["Metric", "Overall", "Natural", "Planned"].map((h) => (
                  <th key={h} style={{ fontWeight: 400, padding: "6px 12px 6px 0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.metric} style={{ borderTop: "1px solid rgba(236,230,218,0.08)" }}>
                  <td style={{ padding: "10px 12px 10px 0", fontFamily: "var(--font-sans)", fontSize: 14 }}>{row.metric}</td>
                  {[row.overall, row.natural, row.planned].map((r, i) => (
                    <td key={i} style={{ padding: "10px 12px 10px 0" }}>
                      {r.total === 0 ? (
                        <span style={{ color: "#5E646D" }}>—</span>
                      ) : (
                        <>
                          <div style={{ color: "#ECE6DA" }}>{pctTxt(r.rate)}</div>
                          <div style={{ color: "#5E646D" }}>
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
