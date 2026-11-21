// OWNER: Dev 4. The stylised demo room every procedural render draws: the rig of four
// phones, the actor's hand keyframes and where each object is at time t. This stands in
// for footage until real clips are in public/clips; it never feeds a label.
import type { CameraId } from "@/lib/types";
import { type Cam, type Vec3, V, mkCam, sstep } from "./math";

export const RIG: Record<CameraId, Cam> = {
  A: mkCam([0, 2.4, 6.6], [0, 0.35, -0.3]),
  B: mkCam([-7, 1.15, 0.8], [0, 0.45, 0]),
  C: mkCam([5.6, 6.6, 4.6], [0, 0, 0.1]),
  D: mkCam([-4.5, 2.2, -6], [0, 0.3, 0], 1.2),
};

export const VIEWS: Record<CameraId, string> = {
  A: "front of the mat, zones A–C",
  B: "left side, zones B–D, low angle",
  C: "high right corner, wide view of zones C–F",
  D: "fell over during the scene (excluded)",
};

/** Hand keyframes: [time s, position]. */
export const HK: [number, Vec3][] = [
  [0, [-0.6, 0.9, 0.6]],
  [2.2, [-0.6, 0.9, 0.6]],
  [3, [-1.6, 0.4, -0.6]],
  [7, [0, 1.5, -2.6]],
  [8.4, [0.4, 0.95, 0]],
  [9, [0.9, 0.3, 0.4]],
  [13, [1.9, 0.22, 1.3]],
  [14.4, [0, 0.95, 1]],
  [15, [-1.9, 0.6, 1.1]],
  [19, [-1.9, 0.6, 1.1]],
  [22, [-0.3, 0.95, 0.4]],
];

/** Hand position at time t, smoothstepped between keyframes. */
export function handAt(t: number): Vec3 {
  for (let i = 0; i < HK.length - 1; i++) {
    const a = HK[i]!;
    const b = HK[i + 1]!;
    if (t <= b[0]) return V.lerp(a[1], b[1], sstep(a[0], b[0], t));
  }
  return HK[HK.length - 1]![1];
}

export interface SceneEntity {
  name: string;
  p: Vec3;
  c: string;
  r: number;
  hidden?: boolean;
  occl?: boolean;
}

/** The room at time t: hand position plus each object. */
export function world(t: number): { hand: Vec3; ents: SceneEntity[] } {
  const h = handAt(t);
  const mug: Vec3 = t < 3 ? [-1.6, 0.15, -0.6] : t < 7 ? V.add(h, [0, -0.18, 0]) : [0, 1.3, -2.7];
  const keys: Vec3 = t < 9 ? [0.9, 0.05, 0.4] : t < 13 ? V.add(h, [0, -0.12, 0]) : [1.9, 0.04, 1.3];
  const phone: Vec3 = t < 2.2 ? [-0.6, 0.05, 0.6] : V.add(h, [0.18, -0.05, 0.12]);
  return {
    hand: h,
    ents: [
      { name: "red mug", p: mug, c: "#FF5A47", r: 0.16 },
      { name: "keys", p: keys, c: "#FFC23D", r: 0.1, hidden: t >= 12.8 },
      { name: "phone", p: phone, c: "#ECE6DA", r: 0.09 },
      { name: "blue box", p: [-1.9, 0.22, 1.1], c: "#6EA8FF", r: 0.22, occl: t >= 15 && t <= 19 },
    ],
  };
}
