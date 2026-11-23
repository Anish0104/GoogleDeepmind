// OWNER: Dev 4. The three landing hero canvases: Convergence (default, a 3D rig with rays
// converging on each event), Braid (four camera strands) and Field (a probability field).
// Ported from the design prototype.
import type { CameraId, Verdict } from "@/lib/types";
import { VERDICT_STYLE } from "@/components/verdictStyle";
import { type Vec3, V, mkCam, pcol, proj, sstep } from "./math";
import { RIG } from "./scene";
import { wbox } from "./drawCam";

export type HeroVariant = "Convergence" | "Braid" | "Field";

export interface HeroState {
  pts: [number, number, number, number][]; // x, y, z, weight
  dust: [number, number, number, number][];
}

export interface HeroInput {
  mx: number; // smoothed pointer, -0.5..0.5 of the viewport
  my: number;
  cx: number; // raw pointer in canvas pixels (-9999 when unknown)
  cy: number;
  scrollY: number;
  theme?: "dark" | "light";
}

/** Mat point cloud and drifting dust. rand is injectable for tests. */
export function makeHeroState(rand: () => number = Math.random): HeroState {
  const pts: HeroState["pts"] = [];
  for (let x = -3; x <= 3.001; x += 0.16) {
    for (let z = -2; z <= 2.001; z += 0.16) {
      const ex = Math.abs((((x + 3) % 2) + 2) % 2);
      const ez = Math.abs((((z + 2) % 2) + 2) % 2);
      const edge = Math.min(ex, 2 - ex) < 0.09 || Math.min(ez, 2 - ez) < 0.09;
      pts.push([x, 0, z, edge ? 1 : 0.3]);
    }
  }
  const dust: HeroState["dust"] = [];
  for (let i = 0; i < 320; i++) dust.push([(rand() - 0.5) * 16, rand() * 6, (rand() - 0.5) * 16, rand()]);
  return { pts, dust };
}

interface HeroEvent {
  p: Vec3;
  label: string;
  v: Verdict;
  cams: CameraId[];
  score: string;
}

export const HERO_EVENTS: HeroEvent[] = [
  { p: [0, 1.3, -2.7], label: "red mug → shelf", v: "Supported", cams: ["A", "B"], score: "0.86" },
  { p: [1.9, 0.05, 1.3], label: "keys → under cloth", v: "Contradicted", cams: ["C"], score: "0.93" },
  { p: [-1.9, 0.22, 1.1], label: "blue box · lid hidden", v: "Insufficient", cams: ["B", "C"], score: "vis 0.38" },
];

export function drawHero(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  variant: HeroVariant,
  st: HeroState,
  inp: HeroInput,
): void {
  if (variant === "Braid") return drawBraid(ctx, w, h, time, inp);
  if (variant === "Field") return drawField(ctx, w, h, time, inp);
  drawConvergence(ctx, w, h, time, st, inp);
}

export function drawConvergence(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  st: HeroState,
  inp: HeroInput,
): void {
  const isLight = inp.theme === "light";
  ctx.fillStyle = isLight ? "#F8F9FA" : "#08090B";
  ctx.fillRect(0, 0, w, h);
  const ox = w > 900 ? w * 0.64 : w * 0.5;
  const g = ctx.createRadialGradient(ox, h * 0.48, 0, ox, h * 0.48, Math.max(w, h) * 0.6);
  g.addColorStop(0, isLight ? "rgba(16,185,129,0.06)" : "rgba(16,185,129,0.08)");
  g.addColorStop(1, isLight ? "rgba(248,249,250,0)" : "rgba(8,9,11,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const sc = inp.scrollY;
  const yaw = time * 0.05 + inp.mx * 0.9 + 0.6;
  const pitch = 0.5 + inp.my * 0.25 + Math.min(sc / 1600, 0.45);
  const dist = 12.5 - Math.min(sc / 140, 4.5);
  const cam = mkCam(
    [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist],
    [0, 0.4, 0],
    0,
    0.95,
  );
  const P = (p: Vec3) => proj(cam, p, w, h, ox);

  for (const d of st.dust) {
    const p = P([d[0] + Math.sin(time * 0.2 + d[3] * 9) * 0.3, d[1] + Math.sin(time * 0.3 + d[3] * 5) * 0.2, d[2]]);
    if (!p) continue;
    ctx.fillStyle = isLight ? `rgba(15,23,42,${0.04 + d[3] * 0.1})` : `rgba(236,230,218,${0.08 + d[3] * 0.18})`;
    const s = Math.max(0.6, 3 / p[2]);
    ctx.fillRect(p[0], p[1], s, s);
  }

  const per = 4.6;
  const ix = Math.floor(time / per) % 3;
  const loc = (time % per) / per;
  const prev = HERO_EVENTS[(ix + 2) % 3]!;
  const ev = HERO_EVENTS[ix]!;
  const E = V.lerp(prev.p, ev.p, sstep(0, 0.18, loc));
  const vc = isLight && ev.v === "Supported" ? "#059669" : VERDICT_STYLE[ev.v].color;

  for (const q of st.pts) {
    const p = P([q[0], q[1], q[2]]);
    if (!p) continue;
    const dx = p[0] - inp.cx;
    const dy = p[1] - inp.cy;
    const near = Math.exp(-(dx * dx + dy * dy) / 14000);
    const de = Math.hypot(q[0] - E[0], q[2] - E[2]);
    const ring = Math.exp(-Math.pow(de - ((time * 2.2) % 4), 2) * 6) * 0.5;
    const a = Math.min(1, (0.12 + q[3] * 0.35 + near * 0.6 + ring) * Math.min(1, 7 / p[2]));
    const s = Math.max(0.8, ((2.2 + near * 2.5) / p[2]) * 3.2);
    ctx.fillStyle = ring > 0.15
      ? (isLight ? `rgba(16,185,129,${a * 0.85})` : `rgba(52,211,153,${a})`)
      : (isLight ? `rgba(30,41,59,${a * 0.65})` : `rgba(236,230,218,${a})`);
    ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
  }

  ctx.strokeStyle = isLight ? "rgba(30,41,59,0.25)" : "rgba(236,230,218,0.35)";
  ctx.lineWidth = 1;
  wbox(ctx, P, [-0.9, 1.05, -3.05], [0.9, 1.15, -2.35]);
  wbox(ctx, P, [-2.15, 0, 0.85], [-1.65, 0.42, 1.35]);
  wbox(ctx, P, [2.4, 0, 2.3], [3.2, 0.8, 2.9]);

  const pE = P(E);
  (["A", "B", "C", "D"] as CameraId[]).forEach((id, k) => {
    const pos = V.lerp([0, 0.4, 0], RIG[id].pos, 0.82);
    const pc = P(pos);
    if (!pc) return;
    const off = id === "D";
    const inv = ev.cams.includes(id);
    const col = off
      ? (isLight ? "rgba(148,163,184," : "rgba(120,126,135,")
      : ev.v === "Insufficient" && inv
        ? "rgba(245,158,11,"
        : inv
          ? ev.v === "Contradicted"
            ? (isLight ? "rgba(225,29,72," : "rgba(255,90,71,")
            : (isLight ? "rgba(5,150,105," : "rgba(91,228,155,")
          : (isLight ? "rgba(100,116,139," : "rgba(236,230,218,");
    const fw = V.norm(V.sub(E, pos));
    const rt = V.norm(V.cross(fw, [0, 1, 0]));
    const up = V.cross(rt, fw);
    const base = V.add(pos, V.scale(fw, 0.7));
    const cn = ([[1, 1], [-1, 1], [-1, -1], [1, -1]] as const).map(([a, b]) =>
      P(V.add(base, V.add(V.scale(rt, a * 0.28), V.scale(up, b * 0.18)))),
    );
    ctx.strokeStyle = col + (off ? "0.4)" : "0.85)");
    ctx.lineWidth = 1.2;
    if (cn.every(Boolean)) {
      const q = cn as [number, number, number][];
      for (const c of q) {
        ctx.beginPath();
        ctx.moveTo(pc[0], pc[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
      }
      ctx.beginPath();
      q.forEach((c, i) => (i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1])));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = col + "0.95)";
    ctx.font = '500 11px var(--font-mono),monospace';
    ctx.fillText(`CAM ${id}${off ? " · excluded" : ""}`, pc[0] + 8, pc[1] - 8);

    if (!off && pE) {
      const reach = ev.v === "Insufficient" && inv ? 0.72 : 1;
      const n = 26;
      ctx.save();
      ctx.globalCompositeOperation = isLight ? "source-over" : "lighter";
      for (let i = 0; i < n; i++) {
        const uu = (i / n + time * 0.45 + k * 0.13) % 1;
        if (uu > reach) continue;
        const p = P(V.lerp(pos, E, uu));
        if (!p) continue;
        const a = (inv ? 0.9 : 0.25) * Math.sin(uu * Math.PI * 0.98 + 0.05);
        ctx.fillStyle = col + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p[0], p[1], inv ? 2.4 : 1.4, 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = col + (inv ? "0.22)" : "0.06)");
      const pr = P(V.lerp(pos, E, reach));
      if (pr) {
        ctx.beginPath();
        ctx.moveTo(pc[0], pc[1]);
        ctx.lineTo(pr[0], pr[1]);
        ctx.stroke();
      }
      ctx.restore();
    }
  });

  if (pE) {
    const pu = (time * 1.4) % 1;
    ctx.strokeStyle = vc;
    ctx.globalAlpha = 1 - pu;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pE[0], pE[1], 8 + pu * 34, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = vc;
    ctx.shadowColor = vc;
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(pE[0], pE[1], 5, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isLight ? "rgba(15,23,42,0.4)" : "rgba(236,230,218,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pE[0] - 18, pE[1]);
    ctx.lineTo(pE[0] - 9, pE[1]);
    ctx.moveTo(pE[0] + 9, pE[1]);
    ctx.lineTo(pE[0] + 18, pE[1]);
    ctx.moveTo(pE[0], pE[1] - 18);
    ctx.lineTo(pE[0], pE[1] - 9);
    ctx.stroke();
    const lx = pE[0] + 26;
    const ly = pE[1] - 34;
    ctx.beginPath();
    ctx.moveTo(pE[0] + 6, pE[1] - 6);
    ctx.lineTo(lx - 4, ly + 10);
    ctx.stroke();
    ctx.font = '500 12px "Geist Mono",monospace';
    ctx.fillStyle = isLight ? "rgba(15,23,42,0.9)" : "rgba(236,230,218,0.9)";
    ctx.fillText(ev.label, lx, ly);
    ctx.fillStyle = vc;
    ctx.fillText(`${VERDICT_STYLE[ev.v].mark} ${ev.v.toUpperCase()}  ${ev.score}`, lx, ly + 17);
  }
}

export function drawBraid(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, inp: HeroInput): void {
  const isLight = inp.theme === "light";
  ctx.fillStyle = isLight ? "#F8F9FA" : "#08090B";
  ctx.fillRect(0, 0, w, h);
  const cy = h * 0.4;
  const cols = isLight
    ? ["14,165,233", "71,85,105", "225,29,72", "217,119,6"]
    : ["124,199,255", "236,230,218", "255,90,71", "255,194,61"];
  ctx.save();
  ctx.globalCompositeOperation = isLight ? "source-over" : "lighter";
  for (let s = 0; s < 4; s++) {
    const N = 340;
    for (let k = 0; k < N; k++) {
      const u = (k / N + time * 0.022 * (1 + s * 0.07)) % 1;
      const x = u * w;
      const amp = h * 0.17 * (1 - 0.93 * Math.exp(-Math.pow((u - 0.46) / 0.075, 2)));
      let y = cy + amp * Math.sin(u * 10 + time * 0.7 + s * 1.57) + Math.sin(time * 0.3 + s) * 6;
      if (s === 2) y += h * 0.2 * sstep(0.66, 0.86, u);
      let a = 0.55;
      if (s === 3) a *= 1 - sstep(0.18, 0.34, u) * 0.85;
      const dx = x - inp.cx;
      const dy = y - inp.cy;
      const m = Math.exp(-(dx * dx + dy * dy) / 12000);
      y += Math.sign(dy || 1) * m * 46 - inp.scrollY * 0.15;
      ctx.fillStyle = `rgba(${cols[s]},${(a * (0.5 + 0.5 * Math.sin(k * 0.37 + time * 2))).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + Math.sin(k * 1.7 + time * 3) * 0.4 + m * 1.4, 0, 7);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.font = '500 11px "Geist Mono",monospace';
  const ax = w * 0.46;
  const bx = w * 0.78;
  ctx.strokeStyle = isLight ? "rgba(71,85,105,0.3)" : "rgba(236,230,218,0.18)";
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(ax, cy - h * 0.26);
  ctx.lineTo(ax, cy + h * 0.22);
  ctx.moveTo(bx, cy - h * 0.26);
  ctx.lineTo(bx, cy + h * 0.36);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = isLight ? "#059669" : "#5BE49B";
  ctx.fillText("✓ A · B · C AGREE  0.86", ax + 8, cy - h * 0.24);
  ctx.fillStyle = isLight ? "#E11D48" : "#FF5A47";
  ctx.fillText("✗ C BREAKS AWAY  0.93", bx + 8, cy - h * 0.24);
  ["A", "B", "C", "D"].forEach((id, s) => {
    ctx.fillStyle = isLight ? "rgba(15,23,42,0.85)" : `rgba(${cols[s]},0.9)`;
    ctx.fillText(`CAM ${id}${id === "D" ? " · lost" : ""}`, w * 0.04, h * 0.14 + s * 16);
  });
}

export function drawField(ctx: CanvasRenderingContext2D, w: number, h: number, time: number, inp: HeroInput): void {
  const isLight = inp.theme === "light";
  ctx.fillStyle = isLight ? "#F8F9FA" : "#08090B";
  ctx.fillRect(0, 0, w, h);
  const cell = 18;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const sweep = ((time * 0.12) % 1) * w;
  ctx.font = '9px "Geist Mono",monospace';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = i * cell + cell / 2;
      const y = j * cell + cell / 2;
      const v =
        0.5 + 0.5 * Math.sin(i * 0.16 + time * 0.8 + Math.sin(j * 0.19 + time * 0.45) * 2.2) * Math.cos(j * 0.11 - time * 0.35);
      const dx = x - inp.cx;
      const dy = y - inp.cy;
      const lens = Math.exp(-(dx * dx + dy * dy) / 15000);
      const sw = Math.exp(-Math.pow((x - sweep) / 40, 2));
      const s = 1.6 + v * 2.4 + lens * 8 + sw * 2;
      ctx.fillStyle = pcol(v, Math.min(1, 0.07 + v * 0.14 + lens * 0.6 + sw * 0.25).toFixed(3));
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      if (lens > 0.72 && (i + j) % 2 === 0) {
        ctx.fillStyle = "rgba(236,230,218,0.85)";
        ctx.fillText(v.toFixed(2), x + 6, y - 4);
      }
    }
  }
  ctx.fillStyle = "rgba(236,230,218,0.5)";
  ctx.fillRect(sweep, 0, 1, h);
  ctx.font = '500 11px "Geist Mono",monospace';
  ctx.fillText(`t=${((sweep / w) * 22).toFixed(1)}s`, sweep + 6, 80);
}
