// OWNER: Dev 1. Test helper: builds a tiny fake SDG-Warehouse run (boxes, masks, RGB) on disk.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const HAS_ZIP = spawnSync("zip", ["-v"]).status === 0;

/** An .npy file: magic, version 1.0, header padded to 64 bytes, raw uint8 data. */
export function npy(shape: number[], data: Uint8Array): Buffer {
  let header = `{'descr': '|u1', 'fortran_order': False, 'shape': (${shape.join(", ")}), }`;
  const pad = 64 - ((10 + header.length + 1) % 64);
  header += " ".repeat(pad % 64) + "\n";
  const pre = Buffer.alloc(10);
  Buffer.from("\x93NUMPY", "latin1").copy(pre, 0);
  pre[6] = 1;
  pre[7] = 0;
  pre.writeUInt16LE(header.length, 8);
  return Buffer.concat([pre, Buffer.from(header, "latin1"), Buffer.from(data)]);
}

/** Writes frames.npy into a zip at npzPath (needs the zip CLI). */
export function writeNpz(npzPath: string, shape: number[], data: Uint8Array): void {
  const tmp = path.join(path.dirname(npzPath), `frames-${process.pid}-${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(path.join(tmp, "frames.npy"), npy(shape, data));
  const r = spawnSync("zip", ["-q", "-j", npzPath, path.join(tmp, "frames.npy")]);
  rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`zip failed: ${r.stderr.toString()}`);
}

export const WORKER_RGBA = [1, 0, 0, 255] as const;
export const FORKLIFT_RGBA = [0, 1, 0, 255] as const;
const key = (c: readonly number[]) => `(${c.join(", ")})`;
export const MAPPING_LINE = JSON.stringify({
  [key(WORKER_RGBA)]: "/World/Characters/Worker/Worker_0/body",
  [key(FORKLIFT_RGBA)]: "/World/Robots/forklift/Forklift/body",
  "(9, 9, 9, 255)": "INVALID",
});

export function box3d(cx: number, cy: number, w: number, h: number) {
  return {
    x_min: -w / 2, x_max: w / 2, y_min: -h / 2, y_max: h / 2, z_min: 0, z_max: 1.6,
    transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [cx, cy, 0, 1]],
  };
}

export interface FakeCamera {
  alias: string;
  /** Per frame: is the worker / forklift in the mask? */
  worker: (frame: number) => boolean;
  forklift: (frame: number) => boolean;
}

/**
 * A run of `frames` frames at 30 fps: the worker stands at the origin, the forklift drives at them
 * along x at 0.75 m/s from x = 2 (contact at about 0.93 s). Masks are 4x4 pixels; RGB is a test pattern.
 */
export function writeFakeRun(dir: string, runId: string, cams: FakeCamera[], frames = 60): void {
  mkdirSync(dir, { recursive: true });
  const det = Array.from({ length: frames }, (_, i) =>
    JSON.stringify({
      agents: {
        "/World/Characters/Worker/Worker_0/x": { label: { class: "character" }, annotators: { bounding_box_3d_fast: box3d(0, 0, 0.5, 0.5) } },
        "/World/Robots/forklift/Forklift": { label: { class: "robot" }, annotators: { bounding_box_3d_fast: box3d(2 - 0.75 * (i / 30), 0, 2, 1) } },
      },
      objects: {},
    }),
  ).join("\n");
  const members = (alias: string) =>
    Object.fromEntries(
      ["camera_params", "object_detection", "instance_id_segmentation", "instance_id_segmentation_mapping", "rgb"].map((k) => [
        k,
        `${runId}.${alias}.${k}.${k === "rgb" ? "mp4" : k === "instance_id_segmentation" ? "npz" : "jsonl"}`,
      ]),
    );
  writeFileSync(
    path.join(dir, `${runId}.meta.json`),
    JSON.stringify({
      run_id: runId,
      scenario: "nearmiss",
      n_cameras: cams.length,
      source_kind: "multi_camera_run",
      cameras: cams.map((c) => ({ camera_alias: c.alias, members: members(c.alias), n_frames_object_detection: frames })),
    }),
  );
  const [H, W] = [4, 4];
  for (const c of cams) {
    const p = (k: string) => path.join(dir, `${runId}.${c.alias}.${k}`);
    writeFileSync(p("object_detection.jsonl"), det + "\n");
    writeFileSync(p("instance_id_segmentation_mapping.jsonl"), Array(frames).fill(MAPPING_LINE).join("\n") + "\n");
    const data = new Uint8Array(frames * H * W * 4);
    for (let f = 0; f < frames; f++) {
      const base = f * H * W * 4;
      if (c.worker(f)) data.set(WORKER_RGBA, base);
      if (c.forklift(f)) data.set(FORKLIFT_RGBA, base + 4);
    }
    writeNpz(p("instance_id_segmentation.npz"), [frames, H, W, 4], data);
    const r = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=320x180:rate=30:duration=${frames / 30}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", p("rgb.mp4"),
    ]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  }
}
