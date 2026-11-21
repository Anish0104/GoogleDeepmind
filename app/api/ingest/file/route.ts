// OWNER: Dev 1. Whole-file upload: one video per camera after the scene (multipart: sceneId, camera, file).
// Saves it as the camera's cam-<X>.webm/.mp4 (iPhone .mov becomes .mp4), like the chunked phone upload,
// so the scene then runs through sync and perception unchanged. Max 500 MB per file.
import { NextResponse } from "next/server";
import { z } from "zod";
import { IngestError, saveRecording } from "@/lib/capture/ingest";
import { NotFoundError } from "@/lib/store/scene";

export const runtime = "nodejs";

const FieldsSchema = z.object({
  sceneId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "invalid sceneId"),
  camera: z.enum(["A", "B", "C", "D"]),
});

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "expected multipart/form-data");
  }
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const fields = FieldsSchema.safeParse({ sceneId: str("sceneId"), camera: str("camera") });
  if (!fields.success) return fail(400, z.prettifyError(fields.error));
  const file = form.get("file");
  if (!(file instanceof Blob)) return fail(400, "file is required");

  try {
    const result = await saveRecording({
      sceneId: fields.data.sceneId,
      camera: fields.data.camera,
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      ...(file instanceof File ? { fileName: file.name } : {}),
    });
    return NextResponse.json({ ok: true, camera: fields.data.camera, ...result });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, e.message);
    if (e instanceof IngestError || e instanceof z.ZodError) return fail(400, e.message);
    console.error("[ingest/file]", e);
    return fail(500, "upload failed");
  }
}
