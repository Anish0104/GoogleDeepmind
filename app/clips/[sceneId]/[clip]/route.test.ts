import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("clips route handler", () => {
  it("rejects invalid path parameters", async () => {
    const res = await GET(new Request("http://localhost/clips/../clip.mp4"), {
      params: Promise.resolve({ sceneId: "..", clip: "clip.mp4" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent clip", async () => {
    const res = await GET(new Request("http://localhost/clips/sdg_nearmiss_run02/nonexistent.mp4"), {
      params: Promise.resolve({ sceneId: "sdg_nearmiss_run02", clip: "nonexistent.mp4" }),
    });
    expect(res.status).toBe(404);
  });

  it("serves an existing clip with 200", async () => {
    const res = await GET(new Request("http://localhost/clips/sdg_nearmiss_run02__true/A_1.00-5.00_full.webm"), {
      params: Promise.resolve({ sceneId: "sdg_nearmiss_run02__true", clip: "A_1.00-5.00_full.webm" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("serves range requests with 206", async () => {
    const req = new Request("http://localhost/clips/sdg_nearmiss_run02__true/A_1.00-5.00_full.webm", {
      headers: { range: "bytes=0-100" },
    });
    const res = await GET(req, {
      params: Promise.resolve({ sceneId: "sdg_nearmiss_run02__true", clip: "A_1.00-5.00_full.webm" }),
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toMatch(/^bytes 0-100\//);
    expect(res.headers.get("Content-Length")).toBe("101");
  });
});
