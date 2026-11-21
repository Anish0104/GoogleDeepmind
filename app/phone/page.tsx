// OWNER: Dev 1. Phone capture page: /phone?scene=<id>&cam=<A-D>.
import type { CameraId } from "@/lib/types";
import PhoneCapture from "./PhoneCapture";

const CAMERAS: readonly string[] = ["A", "B", "C", "D"];
const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const scene = typeof params.scene === "string" ? params.scene : "";
  const cam = typeof params.cam === "string" ? params.cam.toUpperCase() : "";

  if (!SCENE_ID.test(scene) || !CAMERAS.includes(cam)) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Camera</h1>
        <p className="mt-2 text-neutral-600">
          Open this page as <code>/phone?scene=&lt;id&gt;&amp;cam=A</code> (cam is A, B, C or D).
        </p>
      </main>
    );
  }
  return <PhoneCapture sceneId={scene} camera={cam as CameraId} />;
}
