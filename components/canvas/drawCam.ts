// OWNER: Dev 4. Procedural render of the demo mat as one camera sees it at time t, with
// detection brackets, a REC dot and film post-processing. Ported from the design prototype.
import type { CameraId } from "@/lib/types";
import { type Vec3, V, fmt, hash, proj } from "./math";
import { RIG, VIEWS, world } from "./scene";

type P2 = (p: Vec3) => [number, number, number] | null;

/** Stroke the 12 edges of an axis-aligned box from corner a to corner b. */
export function wbox(ctx: CanvasRenderingContext2D, P: P2, a: Vec3, b: Vec3): void {
  const c = (
    [
      [a[0], a[1], a[2]],
      [b[0], a[1], a[2]],
      [b[0], a[1], b[2]],
      [a[0], a[1], b[2]],
      [a[0], b[1], a[2]],
      [b[0], b[1], a[2]],
      [b[0], b[1], b[2]],
      [a[0], b[1], b[2]],
    ] as Vec3[]
  ).map(P);
  if (c.some((x) => !x)) return;
  const q = c as [number, number, number][];
  ctx.beginPath();
  for (const [i, j] of [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7],
  ] as const) {
    ctx.moveTo(q[i]![0], q[i]![1]);
    ctx.lineTo(q[j]![0], q[j]![1]);
  }
  ctx.stroke();
}

/** A 192px random grey canvas used as film noise. Browser only. */
export function makeNoise(): HTMLCanvasElement {
  const nz = document.createElement("canvas");
  nz.width = nz.height = 192;
  const nc = nz.getContext("2d");
  if (nc) {
    const id = nc.createImageData(192, 192);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = Math.random() * 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 38;
    }
    nc.putImageData(id, 0, 0);
  }
  return nz;
}

export interface DrawCamOpts {
  id: CameraId;
  t: number; // scene time to render
  off: boolean; // excluded: desaturate and darken
  time: number; // wall time (s) for blinking and the scan band
  highlight?: string | null; // agent color while an agent inspects this camera
  noise?: CanvasImageSource | null;
}

export function drawCam(ctx: CanvasRenderingContext2D, w: number, h: number, o: DrawCamOpts): void {
  const { id, t, off, time, highlight: hl, noise } = o;
  const c = RIG[id];
  const P: P2 = (p) => proj(c, p, w, h);
  const F = h * c.fov;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0C0F14");
  bg.addColorStop(1, "#07080B");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // floor grid
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(236,230,218,0.05)";
  ctx.beginPath();
  for (let i = -8; i <= 8; i++) {
    const a = P([i, 0, -8]);
    const b = P([i, 0, 8]);
    if (a && b) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    const e = P([-8, 0, i]);
    const f = P([8, 0, i]);
    if (e && f) {
      ctx.moveTo(e[0], e[1]);
      ctx.lineTo(f[0], f[1]);
    }
  }
  ctx.stroke();

  const poly = (pts: Vec3[], fill: string | null, stroke: string | null) => {
    const q = pts.map(P);
    if (q.some((x) => !x)) return;
    ctx.beginPath();
    (q as [number, number, number][]).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };

  // mat, zone dividers, zone letters
  poly([[-3, 0, -2], [3, 0, -2], [3, 0, 2], [-3, 0, 2]], "rgba(236,230,218,0.035)", "rgba(236,230,218,0.4)");
  ctx.strokeStyle = "rgba(236,230,218,0.18)";
  ctx.beginPath();
  for (const [a, b] of [
    [[-1, 0, -2], [-1, 0, 2]],
    [[1, 0, -2], [1, 0, 2]],
    [[-3, 0, 0], [3, 0, 0]],
  ] as [Vec3, Vec3][]) {
    const p = P(a);
    const q = P(b);
    if (p && q) {
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
  }
  ctx.stroke();
  ctx.font = '500 11px "Geist Mono",monospace';
  ctx.fillStyle = "rgba(236,230,218,0.28)";
  for (const [l, x, z] of [["A", -2, -1], ["B", 0, -1], ["C", 2, -1], ["D", -2, 1], ["E", 0, 1], ["F", 2, 1]] as const) {
    const p = P([x, 0, z]);
    if (p) ctx.fillText(l, p[0] - 3, p[1] + 4);
  }

  // cloth, shelf, drawer
  poly([[1.4, 0.01, 0.9], [2.4, 0.01, 0.9], [2.4, 0.01, 1.7], [1.4, 0.01, 1.7]], "rgba(183,156,255,0.14)", "rgba(183,156,255,0.35)");
  ctx.strokeStyle = "rgba(236,230,218,0.3)";
  wbox(ctx, P, [-0.9, 1.05, -3.05], [0.9, 1.15, -2.35]);
  wbox(ctx, P, [2.4, 0, 2.3], [3.2, 0.8, 2.9]);

  // entities and actor, depth sorted
  const W = world(t);
  const items: { z: number; draw: () => void }[] = [];
  for (const e of W.ents) {
    const p = P(e.p);
    if (!p) continue;
    items.push({
      z: p[2],
      draw: () => {
        const r = Math.max(2.5, (e.r * F) / p[2]);
        ctx.globalAlpha = e.hidden ? 0.22 : 1;
        ctx.fillStyle = e.c;
        ctx.shadowColor = e.c;
        ctx.shadowBlur = 14;
        if (e.name === "blue box") ctx.fillRect(p[0] - r, p[1] - r * 0.8, r * 2, r * 1.6);
        else if (e.name === "phone") ctx.fillRect(p[0] - r * 0.6, p[1] - r, r * 1.2, r * 2);
        else {
          ctx.beginPath();
          ctx.arc(p[0], p[1], r, 0, 7);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        if (!e.hidden && !off) {
          const s = r + 7;
          ctx.strokeStyle = e.c;
          ctx.lineWidth = 1.2;
          const L = Math.min(8, s * 0.6);
          ctx.beginPath();
          for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            ctx.moveTo(p[0] + a * s, p[1] + b * s - b * L);
            ctx.lineTo(p[0] + a * s, p[1] + b * s);
            ctx.lineTo(p[0] + a * s - a * L, p[1] + b * s);
          }
          ctx.stroke();
          if (w > 260) {
            const vis = e.occl ? (id === "C" ? 0.44 : 0.38) : 0.82 + hash(e.r * 10, id.charCodeAt(0)) * 0.12;
            ctx.font = '500 10px "Geist Mono",monospace';
            ctx.fillStyle = e.c;
            ctx.fillText(`${e.name} ${vis.toFixed(2)}`, p[0] + s + 4, p[1] - s + 8);
          }
        }
      },
    });
  }
  const torso = V.add(W.hand, [0.2, 0.5, 0.7]);
  const head = V.add(W.hand, [0.2, 1.2, 0.75]);
  const pt = P(torso);
  const ph = P(head);
  const pha = P(W.hand);
  if (pt) {
    items.push({
      z: pt[2],
      draw: () => {
        const r = (0.55 * F) / pt[2];
        const g = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], r * 1.4);
        g.addColorStop(0, "rgba(44,50,62,0.96)");
        g.addColorStop(0.7, "rgba(30,34,42,0.9)");
        g.addColorStop(1, "rgba(30,34,42,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(pt[0], pt[1], r * 0.9, r * 1.4, 0, 0, 7);
        ctx.fill();
        if (ph) {
          const hr = (0.22 * F) / ph[2];
          ctx.fillStyle = "rgba(52,58,70,0.95)";
          ctx.beginPath();
          ctx.arc(ph[0], ph[1], hr, 0, 7);
          ctx.fill();
          ctx.strokeStyle = "rgba(124,199,255,0.35)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (pha) {
          const hr = Math.max(3, (0.14 * F) / pha[2]);
          ctx.fillStyle = "rgba(60,66,80,0.97)";
          ctx.beginPath();
          ctx.arc(pha[0], pha[1], hr * (W.ents[3]?.occl ? 1.8 : 1), 0, 7);
          ctx.fill();
        }
      },
    });
  }
  items.sort((a, b) => b.z - a.z).forEach((i) => i.draw());

  // post: noise, scanlines, vignette
  if (noise) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(noise, -Math.random() * 60, -Math.random() * 60, w + 80, h + 80);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.6)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  if (off) {
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(6,7,9,0.35)";
    ctx.fillRect(0, 0, w, h);
  }

  // HUD
  ctx.font = '600 11px "Geist Mono",monospace';
  ctx.fillStyle = "rgba(236,230,218,0.92)";
  ctx.fillText(`CAM ${id}`, 12, 20);
  if (!off && Math.floor(time * 1.6) % 2 === 0) {
    ctx.fillStyle = "#FF5A47";
    ctx.beginPath();
    ctx.arc(w - 86, 16, 3.5, 0, 7);
    ctx.fill();
  }
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(236,230,218,0.8)";
  ctx.fillText(fmt(t), w - 12, 20);
  if (w > 300) {
    ctx.font = '10px "Geist Mono",monospace';
    ctx.fillStyle = "rgba(236,230,218,0.5)";
    ctx.fillText(VIEWS[id], w - 12, h - 12);
  }
  ctx.textAlign = "left";

  if (hl) {
    ctx.strokeStyle = hl;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    const sy = ((time * 0.8) % 1) * h;
    const g = ctx.createLinearGradient(0, sy - 30, 0, sy);
    g.addColorStop(0, "rgba(124,199,255,0)");
    g.addColorStop(1, hl === "#B79CFF" ? "rgba(183,156,255,0.25)" : "rgba(124,199,255,0.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0, sy - 30, w, 30);
  }
}
