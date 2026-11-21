// OWNER: Dev 3. Tests for GET /api/cost with costStatus() mocked.
import { afterEach, describe, expect, it, vi } from "vitest";

const costStatus = vi.fn();
vi.mock("@/lib/cost", () => ({ costStatus: () => costStatus() }));

const { GET } = await import("@/app/api/cost/route");

afterEach(() => {
  costStatus.mockReset();
  vi.restoreAllMocks();
});

describe("GET /api/cost", () => {
  it("returns costStatus()", async () => {
    costStatus.mockResolvedValue({ spentUsd: 1.25, hardStopUsd: 8, blocked: false });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spentUsd: 1.25, hardStopUsd: 8, blocked: false });
  });

  it("returns 500 with a message when the log can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    costStatus.mockRejectedValue(new Error("EACCES"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not read the cost log." });
  });
});
