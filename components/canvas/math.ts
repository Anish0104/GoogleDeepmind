// OWNER: Dev 4. Small vector and projection helpers shared by every canvas renderer
// (hero, camera tiles, proof clip). A hand-rolled pinhole camera, no three.js.
export type Vec3 = [number, number, number];

export const V = {
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, k: number): Vec3 => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ],
};

/** Smoothstep from a to b, clamped to 0..1. */
export function sstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export interface Cam {
  pos: Vec3;
  f: Vec3;
  r: Vec3;
  u: Vec3;
  roll: number;
  fov: number;
}

/** A camera at pos looking at target. roll in radians, fov as a focal factor of height. */
export function mkCam(pos: Vec3, target: Vec3, roll = 0, fov = 1.05): Cam {
  const f = V.norm(V.sub(target, pos));
  const r = V.norm(V.cross(f, [0, 1, 0]));
  const u = V.cross(r, f);
  return { pos, f, r, u, roll, fov };
}

/** Project a world point to screen [x, y, depth], or null when behind the camera. */
export function proj(
  c: Cam,
  p: Vec3,
  w: number,
  h: number,
  ox?: number,
): [number, number, number] | null {
  const d = V.sub(p, c.pos);
  let x = V.dot(d, c.r);
  let y = V.dot(d, c.u);
  const z = V.dot(d, c.f);
  if (z < 0.15) return null;
  if (c.roll) {
    const cs = Math.cos(c.roll);
    const sn = Math.sin(c.roll);
    const nx = x * cs - y * sn;
    y = x * sn + y * cs;
    x = nx;
  }
  const F = h * c.fov;
  return [(ox ?? w / 2) + (x / z) * F, h / 2 - (y / z) * F, z];
}

/** Deterministic 0..1 hash of two numbers (stable noise for canvases). */
export function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** The pYes color ramp: red #FF5A47 at 0, amber #FFC23D at 0.5, green #5BE49B at 1. */
export function pcol(p: number, a: number | string): string {
  const q = Math.max(0, Math.min(1, p));
  const r = q < 0.5 ? 255 : Math.round(255 - 164 * (q - 0.5) * 2);
  const g = q < 0.5 ? Math.round(90 + 104 * q * 2) : Math.round(194 + 34 * (q - 0.5) * 2);
  const b = q < 0.5 ? Math.round(71 - 10 * q * 2) : Math.round(61 + 94 * (q - 0.5) * 2);
  return `rgba(${r},${g},${b},${a})`;
}

/** mm:ss.ss timecode. */
export function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const x = s - m * 60;
  return `${String(m).padStart(2, "0")}:${x.toFixed(2).padStart(5, "0")}`;
}

/** A 0..1 fraction as a CSS percentage, clamped. */
export function pct(x: number): string {
  return `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;
}

/** "9–13s" */
export function winTxt(w: readonly [number, number]): string {
  return `${w[0]}–${w[1]}s`;
}
