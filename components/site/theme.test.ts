// OWNER: Dev 4. Pure helpers and contract tests for the theme system.
import { describe, expect, it } from "vitest";
import { STORAGE_KEY, nextTheme, type Theme } from "./ThemeContext";

describe("theme system", () => {
  it("uses the consistent localStorage key", () => {
    expect(STORAGE_KEY).toBe("vera-theme");
  });

  it("toggles between dark and light themes predictably", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("cycles cleanly over multiple toggles", () => {
    let t: Theme = "dark";
    t = nextTheme(t);
    expect(t).toBe("light");
    t = nextTheme(t);
    expect(t).toBe("dark");
    t = nextTheme(t);
    expect(t).toBe("light");
  });
});
