// OWNER: Dev 1.
import { describe, expect, it, vi } from "vitest";
import { MIME_PREFERENCE, extensionFor, pickMimeType, uploadChunk } from "@/app/phone/capture";

describe("pickMimeType", () => {
  it("prefers webm with opus, then falls back to mp4 (iPhone)", () => {
    expect(pickMimeType(() => true)).toBe(MIME_PREFERENCE[0]);
    expect(pickMimeType((m) => m.startsWith("video/mp4"))).toMatch(/^video\/mp4/);
    expect(pickMimeType(() => false)).toBe("");
  });
});

describe("extensionFor", () => {
  it("maps mime types to file extensions", () => {
    expect(extensionFor("video/webm;codecs=vp8,opus")).toBe("webm");
    expect(extensionFor("video/mp4")).toBe("mp4");
  });
});

describe("uploadChunk", () => {
  const blob = new Blob(["x"], { type: "video/webm" });
  const fields = { sceneId: "s1", camera: "A" as const, seq: 3 };

  it("posts the multipart fields", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const f = init!.body as FormData;
      expect([f.get("sceneId"), f.get("camera"), f.get("seq")]).toEqual(["s1", "A", "3"]);
      expect(f.get("chunk")).toBeInstanceOf(Blob);
      return new Response('{"ok":true}', { status: 200 });
    });
    await uploadChunk({ ...fields, blob }, { fetchFn, sleep: async () => {} });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries network errors and 5xx, then succeeds", async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError("network");
      if (n === 2) return new Response("{}", { status: 503 });
      return new Response('{"ok":true}', { status: 200 });
    });
    await uploadChunk({ ...fields, blob }, { fetchFn, sleep: async () => {} });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 and reports the server error", async () => {
    const fetchFn = vi.fn(async () => new Response('{"ok":false,"error":"camera C is not part"}', { status: 400 }));
    await expect(uploadChunk({ ...fields, blob }, { fetchFn, sleep: async () => {} })).rejects.toThrow(
      "camera C is not part",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(
      uploadChunk({ ...fields, blob }, { fetchFn, sleep: async () => {}, attempts: 3 }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("sends done=1 without a chunk to finalize", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const f = init!.body as FormData;
      expect(f.get("done")).toBe("1");
      expect(f.get("chunk")).toBeNull();
      return new Response('{"ok":true,"chunks":5}', { status: 200 });
    });
    const res = await uploadChunk({ sceneId: "s1", camera: "A", done: true }, { fetchFn, sleep: async () => {} });
    expect(res).toMatchObject({ chunks: 5 });
  });
});
