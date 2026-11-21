// OWNER: Dev 1. Receives 1-second video chunks per camera (multipart: sceneId, camera, seq, chunk).
// Send done=1 (no chunk) when the phone stops to join the chunks into cam-<X>.webm/.mp4.
import { NextResponse } from "next/server";
import { z } from "zod";
import { IngestError, finalizeCamera, saveChunk } from "@/lib/capture/ingest";
import { NotFoundError } from "@/lib/store/scene";

export const runtime = "nodejs";

const FieldsSchema = z.object({
  sceneId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "invalid sceneId"),
  camera: z.enum(["A", "B", "C", "D"]),
  seq: z.coerce.number().int().min(0).optional(),
  done: z.literal("1").optional(),
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
  const fields = FieldsSchema.safeParse({
    sceneId: str("sceneId"),
    camera: str("camera"),
    seq: str("seq"),
    done: str("done"),
  });
  if (!fields.success) return fail(400, z.prettifyError(fields.error));
  const { sceneId, camera, seq, done } = fields.data;

  try {
    if (done) {
      const result = await finalizeCamera(sceneId, camera);
      return NextResponse.json({ ok: true, ...result });
    }
    const chunk = form.get("chunk");
    if (seq === undefined || !(chunk instanceof Blob)) return fail(400, "chunk and seq are required");
    const { bytes } = await saveChunk({
      sceneId,
      camera,
      seq,
      data: new Uint8Array(await chunk.arrayBuffer()),
      mimeType: chunk.type,
    });
    return NextResponse.json({ ok: true, seq, bytes });
  } catch (e) {
    if (e instanceof NotFoundError) return fail(404, e.message);
    if (e instanceof IngestError || e instanceof z.ZodError) return fail(400, e.message);
    console.error("[ingest]", e);
    return fail(500, "ingest failed");
  }
}
