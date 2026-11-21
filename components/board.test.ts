// OWNER: Dev 4. Pure helpers exported by the board components.
import { describe, expect, it } from "vitest";
import { proofHref } from "./Board";
import { toggleCamera } from "./CameraGrid";
import { sharedNoise } from "./CameraTile";
import { boardHref } from "./ScenePicker";
import { phaseOf } from "./Transport";

describe("board helpers", () => {
  it("toggles a camera in the excluded list", () => {
    expect(toggleCamera(["D"], "A")).toEqual(["D", "A"]);
    expect(toggleCamera(["D", "A"], "D")).toEqual(["A"]);
  });

  it("names the replay phase", () => {
    expect(phaseOf(5, 22, 35).label).toBe("FOOTAGE PASS");
    expect(phaseOf(25, 22, 35).label).toBe("AGENTS RUNNING");
    expect(phaseOf(35, 22, 35).label).toBe("COMPLETE");
  });

  it("links to proof and board, keeping a non-default scene", () => {
    expect(proofHref("c2", "fixtures/replay/demo-001", "fixtures/replay/demo-001")).toBe("/proof/c2");
    expect(proofHref("c2", "data/scenes/s1", "fixtures/replay/demo-001")).toBe("/proof/c2?scene=data%2Fscenes%2Fs1");
    expect(boardHref("data/scenes/s1")).toBe("/board?scene=data%2Fscenes%2Fs1");
  });

  it("has no noise texture outside the browser", () => {
    expect(sharedNoise()).toBeNull();
  });
});
