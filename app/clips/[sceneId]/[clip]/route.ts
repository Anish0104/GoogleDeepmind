// OWNER: Dev 4 / Dev 1. Serves evidence video clips from data/scenes/<sceneId>/clips/
// or fixtures/replay/<sceneId>/clips/. Supports byte-range requests for smooth video scrubbing.
import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ sceneId: string; clip: string }> },
) {
  const { sceneId, clip } = await ctx.params;
  const clipBase = clip.replace(/\.(mp4|webm)$/i, "");

  // Safe identifier check
  if (!/^[A-Za-z0-9_-]+$/.test(sceneId) || !/^[A-Za-z0-9_.-]+$/.test(clipBase)) {
    return new NextResponse("Invalid parameters", { status: 400 });
  }

  const candidates = [
    path.join(DATA_DIR, "scenes", sceneId, "clips", `${clipBase}.mp4`),
    path.join(DATA_DIR, "scenes", sceneId, "clips", `${clipBase}.webm`),
    path.join(process.cwd(), "data", "scenes", sceneId, "clips", `${clipBase}.mp4`),
    path.join(process.cwd(), "data", "scenes", sceneId, "clips", `${clipBase}.webm`),
    path.join(process.cwd(), "fixtures", "replay", sceneId, "clips", `${clipBase}.mp4`),
    path.join(process.cwd(), "fixtures", "replay", sceneId, "clips", `${clipBase}.webm`),
    path.join(process.cwd(), "public", "clips", sceneId, `${clipBase}.mp4`),
    path.join(process.cwd(), "public", "clips", sceneId, `${clipBase}.webm`),
  ];

  let target: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      target = c;
      break;
    }
  }

  if (!target) {
    return new NextResponse("Clip not found", { status: 404 });
  }

  const stat = statSync(target);
  const ext = path.extname(target).toLowerCase();
  const mime = ext === ".webm" ? "video/webm" : "video/mp4";

  // Support range headers for video scrubbing
  const range = req.headers.get("range");
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0] || "0", 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunksize = end - start + 1;
    const nodeStream = createReadStream(target, { start, end });
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(webStream as unknown as BodyInit, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunksize),
        "Content-Type": mime,
      },
    });
  }

  const nodeStream = createReadStream(target);
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(webStream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
    },
  });
}
