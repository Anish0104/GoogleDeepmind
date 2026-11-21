// OWNER: Dev 3. Answer-key reading and account building, on tiny fake truth files.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CameraId } from "@/lib/types";
import { buildCase, transcriptOf, workerVisible, type EvalCase, type Statement } from "@/scripts/eval/accounts";
import { readTruth } from "@/scripts/eval/truth";
import { fakeTruth } from "@/scripts/eval/fixtures";

const ALL = { cameras: ["A", "B", "C", "D"] as CameraId[], excludedCameras: [] as CameraId[] };
const by = (c: EvalCase, account: "true" | "mixed") => Object.fromEntries(c.accounts.find((a) => a.name === account)!.statements.map((s) => [s.kind, s])) as Record<string, Statement>;

// Contact at 3.2 s; the worker started dodging at 2.3 s (before the closest point); the forklift never stopped.
const contactTruth = fakeTruth({ sceneId: "fk_contact", outcome: "contact", contact: [3.167, 3.467], minGapT: 3.233, dodgeStartT: 2.3 });
// Near miss at 6.1 s; forklift stopped at 5.5 s; the worker never dodged. Around 5–7 s only D sees the worker.
const nearTruth = fakeTruth({ sceneId: "fk_near", outcome: "near_miss", minGapT: 6.1, forkliftStopT: 5.5, hidden: [5, 7.2], hiddenFrom: ["A", "B", "C"] });

describe("answer key", () => {
  it("accepts files without summary.near and summary.forkliftStopT", () => {
    const t = fakeTruth({ sceneId: "x", outcome: "contact", contact: [1, 1.5], minGapT: 1.2, omit: ["near", "forkliftStopT"] });
    expect(t.summary.near).toBeUndefined();
    expect(t.summary.forkliftStopT).toBeUndefined();
  });

  it("readTruth reads data/labels/<sceneId>.truth.json, validates it and checks the scene id", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rashomon-truth-"));
    try {
      await mkdir(path.join(dir, "labels"));
      await writeFile(path.join(dir, "labels", "fk_contact.truth.json"), JSON.stringify(contactTruth));
      expect((await readTruth("fk_contact", dir)).summary.outcome).toBe("contact");
      await writeFile(path.join(dir, "labels", "wrong.truth.json"), JSON.stringify(contactTruth));
      await expect(readTruth("wrong", dir)).rejects.toThrow(/is for scene fk_contact/);
      await writeFile(path.join(dir, "labels", "bad.truth.json"), JSON.stringify({ sceneId: "bad", summary: {}, slices: [] }));
      await expect(readTruth("bad", dir)).rejects.toThrow(/malformed/);
      await expect(readTruth("../scenes/x", dir)).rejects.toThrow(/Invalid scene id/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildCase: contact scene", () => {
  const c = buildCase(contactTruth, ALL);
  const t = by(c, "true");

  it("true account: every statement true, with the right wording", () => {
    expect(Object.fromEntries(Object.values(t).map((s) => [s.kind, [s.text, s.truth]]))).toEqual({
      contact: ["The forklift hit me.", true],
      dodge: ["I got out of the way before it reached me.", true], // 2.3 < 3.233
      stop: ["The forklift didn't stop before it reached me.", true], // never stopped
      moving: ["It kept moving the whole time.", true],
      time: ["It hit me about 3 seconds in.", true], // round(3.167)
    });
  });

  it("moments: contact window +/- 1 s, the whole clip for moving", () => {
    expect(t.contact!.moment).toEqual([2.167, 4.467]);
    expect(t.moving!.moment).toEqual([0, 10]);
  });

  it("expected: Supported where the worker is visible and the statement is true", () => {
    expect(Object.values(t).map((s) => s.expected)).toEqual(["Supported", "Supported", "Supported", "Supported", "Supported"]);
  });

  it("mixed account: exactly 2 statements flipped to their false wording, expected Contradicted", () => {
    const m = c.accounts.find((a) => a.name === "mixed")!;
    expect(m.flipped).toHaveLength(2);
    for (const s of m.statements) {
      const flipped = m.flipped.includes(s.kind);
      expect(s.truth).toBe(!flipped);
      expect(s.expected).toBe(flipped ? "Contradicted" : "Supported");
    }
  });

  it("a false time statement is shifted by at least 3 s and stays inside the clip", () => {
    for (let seed = 0; seed < 40; seed++) {
      const m = buildCase(contactTruth, ALL, seed).accounts.find((a) => a.name === "mixed")!;
      const time = m.statements.find((s) => s.kind === "time" && !s.truth);
      if (!time) continue;
      const n = Number(/about (\d+) seconds/.exec(time.text)![1]);
      expect(Math.abs(n - 3)).toBeGreaterThanOrEqual(3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it("is deterministic: same scene and seed give the same accounts; the transcript joins the statements", () => {
    expect(buildCase(contactTruth, ALL)).toEqual(c);
    expect(t.contact).toBeDefined();
    const m = c.accounts[1]!;
    expect(m.transcript).toBe(transcriptOf(m.statements));
    expect(c.accounts[0]!.transcript).toBe(
      "The forklift hit me. I got out of the way before it reached me. The forklift didn't stop before it reached me. It kept moving the whole time. It hit me about 3 seconds in.",
    );
  });
});

describe("buildCase: near miss with a hidden-worker moment", () => {
  it("true account: near-miss wording, time from minGapT", () => {
    const t = by(buildCase(nearTruth, ALL), "true");
    expect(t.contact!.text).toBe("It never touched me.");
    expect(t.dodge!.text).toBe("I didn't get out of the way before it reached me.");
    expect(t.stop!.text).toBe("The forklift stopped before it reached me."); // 5.5 < 6.1
    expect(t.moving!.text).toBe("It stopped at some point.");
    expect(t.time!.text).toBe("It came closest about 6 seconds in.");
    expect(t.contact!.moment).toEqual([5.1, 7.1]);
  });

  it("the worker is visible only on D around the moment: with D included it is decidable", () => {
    const t = by(buildCase(nearTruth, ALL), "true");
    expect(t.contact!.expected).toBe("Supported");
  });

  it("with D excluded, the moment's statements are expected Insufficient; 'moving' (whole clip) still decidable", () => {
    const t = by(buildCase(nearTruth, { cameras: ["A", "B", "C", "D"], excludedCameras: ["D"] }), "true");
    for (const k of ["contact", "dodge", "stop", "time"]) expect(t[k]!.expected, k).toBe("Insufficient");
    expect(t.moving!.expected).toBe("Supported");
  });

  it("workerVisible ignores 'unclear' and cameras missing from a slice", () => {
    const t = structuredClone(nearTruth);
    for (const s of t.slices) s.cameras = { A: { "worker:visible:yes": "unclear" } };
    expect(workerVisible(t, [0, 10], ["A", "B"])).toBe(false);
  });
});

describe("buildCase: missing fields", () => {
  it("a missing forkliftStopT counts as never stopped; a missing dodgeStartT skips the dodge statement", () => {
    const t = fakeTruth({ sceneId: "fk_old", outcome: "contact", contact: [3, 3.3], minGapT: 3.1, omit: ["forkliftStopT", "dodgeStartT", "near"] });
    const c = buildCase(t, ALL);
    const s = by(c, "true");
    expect(s.moving!.text).toBe("It kept moving the whole time.");
    expect(s.stop!.text).toBe("The forklift didn't stop before it reached me.");
    expect(s.dodge).toBeUndefined();
    expect(c.skipped).toEqual([{ kind: "dodge", reason: "answer key has no summary.dodgeStartT" }]);
  });

  it("a near miss without minGapT keeps only the whole-clip statement", () => {
    const t = fakeTruth({ sceneId: "fk_nogap", outcome: "near_miss" });
    const c = buildCase(t, ALL);
    expect(c.accounts[0]!.statements.map((s) => s.kind)).toEqual(["moving"]);
    expect(c.skipped.map((x) => x.kind)).toEqual(["contact", "dodge", "stop", "time"]);
    expect(c.accounts[1]!.flipped).toEqual(["moving"]); // only one flippable statement
  });
});
