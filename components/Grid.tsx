// OWNER: Dev 4. The live grid: per-camera pYes over time, one block per slice.
// Visibility below USABLE is dimmed so blind spots read as blind spots, not low answers.
import { THRESHOLDS } from "@/lib/config";
import type { CameraId, GridRow, Question } from "@/lib/types";

function cell(row: GridRow | undefined) {
  if (!row) return "bg-neutral-100 text-neutral-300";
  const usable = row.pVisible >= THRESHOLDS.USABLE;
  if (!usable) return "bg-neutral-200 text-neutral-400";
  if (row.pYes >= 0.7) return "bg-emerald-500 text-white";
  if (row.pYes <= 0.3) return "bg-neutral-300 text-neutral-700";
  return "bg-amber-300 text-amber-900";
}

export function Grid({
  grid,
  cameras,
  questions,
  excluded = [],
}: {
  grid: GridRow[];
  cameras: CameraId[];
  questions: Question[];
  excluded?: CameraId[];
}) {
  const times = [...new Set(grid.map((r) => r.t))].sort((a, b) => a - b);
  const byKey = new Map(grid.map((r) => [`${r.questionId}:${r.camera}:${r.t}`, r]));
  const isExcluded = (cam: CameraId) => excluded.includes(cam);

  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <div key={q.id}>
          <div className="mb-1 text-sm text-neutral-700">{q.text}</div>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1 text-xs">
              <thead>
                <tr>
                  <th className="w-10" />
                  {times.map((t) => (
                    <th key={t} className="w-10 font-mono font-normal text-neutral-400">
                      {t}s
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cameras.map((cam) => (
                  <tr key={cam} className={isExcluded(cam) ? "opacity-30" : ""}>
                    <td className="pr-1 font-mono text-neutral-500">{cam}</td>
                    {times.map((t) => {
                      const row = byKey.get(`${q.id}:${cam}:${t}`);
                      return (
                        <td
                          key={t}
                          className={`h-7 w-10 rounded text-center align-middle font-mono ${cell(row)}`}
                          title={
                            isExcluded(cam)
                              ? "camera excluded by operator"
                              : row
                                ? `pYes ${row.pYes} · vis ${row.pVisible}`
                                : "no answer"
                          }
                        >
                          {row ? row.pYes.toFixed(2).slice(1) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
