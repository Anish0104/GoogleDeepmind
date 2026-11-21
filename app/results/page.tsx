// OWNER: Dev 4. Results table + charts. Reads the same eval inputs as `pnpm eval:report`
// (data/scenes + data/labels) and renders them. Safety metric (false-contradiction) first.
import type { Rate } from "@/eval/stats";
import { computeMetrics, loadEvalInputs } from "@/eval/report";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Cell({ rate }: { rate: Rate }) {
  if (rate.total === 0) return <span className="text-neutral-300">{"—"}</span>;
  return (
    <div>
      <div className="font-mono text-sm text-neutral-900">{pct(rate.rate)}</div>
      <div className="font-mono text-xs text-neutral-400">
        {rate.count}/{rate.total} &middot; [{pct(rate.low)}&ndash;{pct(rate.high)}]
      </div>
    </div>
  );
}

export default async function ResultsPage() {
  const { items, agreement, scenes } = await loadEvalInputs();
  const rows = computeMetrics(items);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="border-b border-neutral-200 pb-4">
        <h1 className="text-xl font-semibold tracking-tight">Results</h1>
        <p className="font-mono text-xs text-neutral-500">
          {scenes} scene(s) &middot; {items.length} scored claim(s) &middot; 95% Wilson intervals
        </p>
      </header>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          No scored claims yet. Generate scenes and labels, then this table fills in.
        </p>
      ) : (
        <>
          <table className="mt-6 w-full border-separate border-spacing-y-1">
            <thead>
              <tr className="text-left text-xs font-medium text-neutral-500">
                <th className="py-1">Metric</th>
                <th className="py-1">Overall</th>
                <th className="py-1">Natural</th>
                <th className="py-1">Planned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.metric}
                  className={i === 0 ? "bg-amber-50" : "bg-white"}
                  title={i === 0 ? "The safety number: a true or unseeable claim called Contradicted." : undefined}
                >
                  <td className="rounded-l-md py-2 pl-3 pr-4 text-sm text-neutral-800">
                    {i === 0 && <span className="mr-1" aria-hidden>{"⚠"}</span>}
                    {row.metric}
                  </td>
                  <td className="px-4 py-2"><Cell rate={row.overall} /></td>
                  <td className="px-4 py-2"><Cell rate={row.natural} /></td>
                  <td className="rounded-r-md px-4 py-2"><Cell rate={row.planned} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 flex items-baseline gap-3 border-t border-neutral-100 pt-4">
            <span className="text-sm text-neutral-500">Labeler agreement</span>
            <span className="font-mono text-sm text-neutral-900">{pct(agreement.rate)}</span>
            <span className="font-mono text-xs text-neutral-400">
              {agreement.count}/{agreement.total} &middot; [{pct(agreement.low)}&ndash;{pct(agreement.high)}]
            </span>
          </div>
        </>
      )}
    </main>
  );
}
