// OWNER: Dev 4.
import { describe, expect, it } from "vitest";
import { loadScene } from "@/components/loadScene";
import { defaultProofClaim } from "./defaultClaim";

describe("defaultProofClaim", () => {
  it("opens the first Contradicted claim, else the first, else nothing", async () => {
    const s = await loadScene("fixtures/replay/demo-001");
    expect(defaultProofClaim(s.claims, s.results)).toBe("c2");
    expect(defaultProofClaim(s.claims, [])).toBe("c1");
    expect(defaultProofClaim([], [])).toBeNull();
  });
});
