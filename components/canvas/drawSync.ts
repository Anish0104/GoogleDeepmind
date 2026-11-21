// OWNER: Dev 4. The Capture screen's sync canvas: four waveform rows whose clap spikes
// slide into line as sync progresses 0 → 1, then a cyan t₀ line.
import type { CameraId } from "@/lib/types";
import { hash, sstep } from "./math";

/** Demo sync offsets in seconds (what the clap + flash detector reports for demo-001). */
export const SYNC_OFFSETS: Record<CameraId, number> = { A: 0, B: 0.412, C: -0.236, D: 0.118 };

export function drawSync(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number,
  syncing: boolean,
  time: number,
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  const p = sstep(0, 1, progress);
  const cx = w * 0.55;
  const rh = h / 4;
  ctx.font = '500 11px "Geist Mono",monospace';
  (["A", "B", "C", "D"] as CameraId[]).forEach((id, i) => {
    const yc = i * rh + rh / 2;
    const clap = cx + SYNC_OFFSETS[id] * (1 - p) * w * 0.6;
    const col = id === "D" ? "rgba(125,131,140," : "rgba(236,230,218,";
    ctx.fillStyle = col + "0.8)";
    ctx.fillText(`CAM ${id}`, 10, yc + 4);
    ctx.strokeStyle = col + "0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 64; x < w - 8; x += 2) {
      const n = hash(i * 31 + x, 3) * 2 - 1;
      const sp = Math.exp(-Math.pow((x - clap) / 5, 2));
      const env = 0.18 + 0.12 * Math.sin(x * 0.03 + i);
      const a = (n * env + sp * (hash(x, i) > 0.5 ? 1 : -1)) * rh * 0.42;
      ctx.moveTo(x, yc - Math.abs(a));
      ctx.lineTo(x, yc + Math.abs(a));
    }
    ctx.stroke();
    ctx.fillStyle = p >= 1 ? "#7CC7FF" : "#FFC23D";
    ctx.fillRect(clap + 16, yc - rh * 0.3, 6, 6);
  });
  if (p >= 1) {
    ctx.strokeStyle = "#7CC7FF";
    ctx.shadowColor = "#7CC7FF";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, h - 4);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#7CC7FF";
    ctx.fillText("CLAP + FLASH · t₀", cx + 30, 14);
  } else if (syncing) {
    const sx = 64 + ((time * 0.9) % 1) * (w - 72);
    ctx.fillStyle = "rgba(124,199,255,0.18)";
    ctx.fillRect(sx, 0, 2, h);
  }
}
