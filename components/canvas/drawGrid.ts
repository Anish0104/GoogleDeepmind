// OWNER: Dev 4. The evidence grid canvas: one group per question, one row per camera,
// one cell per slice. Cell color is pYes on the red→amber→green ramp, brightness is
// pVisible. Excluded cameras dim, and slices after the playhead stay dark so the grid
// fills in as the replay plays.
import { LIMITS } from "@/lib/config";
import type { CameraId, Claim, GridRow, Question } from "@/lib/types";
import { pcol } from "./math";

/** Pixel height of one question group. */
export const GRID_GROUP_H = 75;

/** The slice width the grid was sampled at: the smallest gap between distinct slice starts. */
export function sliceWidth(grid: GridRow[]): number {
  const ts = [...new Set(grid.map((r) => r.t))].sort((a, b) => a - b);
  let w = Infinity;
  for (let i = 1; i < ts.length; i++) w = Math.min(w, ts[i]! - ts[i - 1]!);
  return Number.isFinite(w) && w > 0 ? w : LIMITS.SLICE_S;
}

/** Questions to draw: the scene's list, plus any question id the grid uses but the list lacks. */
export function gridQuestions(grid: GridRow[], questions: Question[]): { id: string; label: string }[] {
  const out = questions.map((q) => ({ id: q.id, label: `${q.id} · ${q.text}` }));
  const known = new Set(out.map((q) => q.id));
  for (const r of grid) {
    if (!known.has(r.questionId)) {
      known.add(r.questionId);
      out.push({ id: r.questionId, label: r.questionId });
    }
  }
  return out;
}

export interface DrawGridOpts {
  grid: GridRow[];
  questions: Question[];
  cameras: CameraId[];
  excluded: CameraId[];
  claims: Claim[];
  foot: number;
  T: number;
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawGridOpts): void {
  ctx.clearRect(0, 0, w, h);
  const qs = gridQuestions(o.grid, o.questions);
  ctx.font = '500 11px "Geist Mono",monospace';
  if (qs.length === 0 || o.grid.length === 0) {
    ctx.fillStyle = "rgba(125,131,140,0.9)";
    ctx.fillText("No grid for this scene yet.", 0, 16);
    return;
  }
  const narrow = w < 560;
  const lw = narrow ? 96 : 170;
  const gw = w - lw;
  const foot = o.foot > 0 ? o.foot : 1;
  const ft = Math.min(o.T, foot);
  const sw = sliceWidth(o.grid);
  const cw = (sw / foot) * gw;
  const gh = h / qs.length;
  const cams = o.cameras.length ? o.cameras : (["A", "B", "C", "D"] as CameraId[]);
  const rh = (gh - 22) / cams.length;
  const byKey = new Map(o.grid.map((r) => [`${r.questionId}:${r.camera}:${r.t}`, r]));
  const times = [...new Set(o.grid.map((r) => r.t))].sort((a, b) => a - b);

  qs.forEach((q, qi) => {
    const y0 = qi * gh;
    ctx.fillStyle = "rgba(236,230,218,0.75)";
    ctx.font = '500 11px "Geist Mono",monospace';
    ctx.fillText(narrow ? q.id : q.label, 0, y0 + 12);
    cams.forEach((cam, ci) => {
      const y = y0 + 18 + ci * rh;
      const off = o.excluded.includes(cam);
      ctx.fillStyle = off ? "rgba(125,131,140,0.4)" : "rgba(125,131,140,0.9)";
      ctx.fillText(cam, lw - 18, y + rh - 3);
      // empty track so missing slices read as "no answer", not as zero
      ctx.fillStyle = "rgba(236,230,218,0.025)";
      ctx.fillRect(lw, y, gw, rh - 2);
      for (const t of times) {
        if (t >= foot) continue;
        const row = byKey.get(`${q.id}:${cam}:${t}`);
        if (!row) continue;
        let a = 0.12 + row.pVisible * 0.88;
        if (off) a *= 0.2;
        if (t > ft) a *= 0.12;
        ctx.fillStyle = pcol(row.pYes, a.toFixed(3));
        ctx.fillRect(lw + (t / foot) * gw + 0.5, y, Math.max(1, cw - 1.5), rh - 2);
      }
    });
  });

  for (const c of o.claims) {
    if (c.window[1] - c.window[0] >= foot * 0.9) continue; // whole-scene claims would outline everything
    const x0 = lw + (c.window[0] / foot) * gw;
    const x1 = lw + (Math.min(c.window[1], foot) / foot) * gw;
    ctx.strokeStyle = "rgba(236,230,218,0.25)";
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(x0, 0.5, x1 - x0, h - 1);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(236,230,218,0.5)";
    ctx.font = '10px "Geist Mono",monospace';
    ctx.fillText(c.id, x0 + 3, h - 4);
  }

  const px = lw + (ft / foot) * gw;
  ctx.fillStyle = "#ECE6DA";
  ctx.shadowColor = "#ECE6DA";
  ctx.shadowBlur = 10;
  ctx.fillRect(px - 1, 0, 2, h);
  ctx.shadowBlur = 0;
}
