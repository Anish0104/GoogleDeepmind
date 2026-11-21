// OWNER: Dev 3. Kill test H, offline mode only (no Gemini, no video): the same function `pnpm killtest h` runs.
import { beforeAll, describe, expect, it } from "vitest";
import type { TurnInput, TurnOutput } from "@/lib/agent/loop";
import type { AgentStep } from "@/lib/types";
import {
  buildScene,
  callsFromSteps,
  CASES,
  CLAIMS,
  formatReport,
  replayTurn,
  runKillTestH,
  savedCallsOf,
  type HReport,
  type SavedCalls,
} from "@/scripts/killtests/h";

// Whole kill-test runs are slow-ish under the parallel suite; give them room instead of the 5 s default.
describe("kill test H (offline: safety checks only)", { timeout: 60_000 }, () => {
  let report: HReport;
  beforeAll(async () => {
    report = await runKillTestH("offline");
  }, 60_000);

  it("passes: 0 right labels changed, 0 new Contradicted, at least 3 of 5 wrong labels downgraded", () => {
    const r = report;
    expect(r.label).toBe("H offline: safety checks only");
    expect(r.rightChanged).toBe(0);
    expect(r.newContradicted).toBe(0);
    expect(r.wrongTotal).toBe(5);
    expect(r.wrongDowngraded).toBeGreaterThanOrEqual(3);
    expect(r.pass).toBe(true);
    expect(r.rows.map((x) => [x.claimId, x.initial])).toEqual(CASES.map((c) => [c.id, c.initial]));
    for (const row of r.rows) expect(row.steps).toMatch(/inspect/);
  });

  it("the scene is as specified: 10 decided Skeptic-eligible claims, 5 right and 5 wrong, built deterministically", () => {
    const a = buildScene(); // throws if any claim isn't decided as designed or isn't Skeptic-eligible
    const b = buildScene();
    expect(a.stillsRows).toEqual(b.stillsRows);
    expect(a.clipRows).toEqual(b.clipRows);
    expect(CLAIMS).toHaveLength(10);
    expect(CASES.filter((c) => c.kind === "right")).toHaveLength(5);
    expect([...a.initial.values()].every((r) => r.verdict !== "Insufficient")).toBe(true);
    // In 3 of the 5 wrong claims only one included camera can see the truth in a clip.
    expect(CASES.filter((c) => c.kind === "wrong" && c.clipsBlocked.length === 2).map((c) => c.id)).toEqual(["w2", "w3", "w5"]);
  });

  it("runs are reproducible", async () => {
    expect(await runKillTestH("offline")).toEqual(report);
  });

  it("picking the right camera matters: checking cameras alphabetically misses w2 (only C sees the truth)", async () => {
    const alphabetical = async ({ menu }: TurnInput): Promise<TurnOutput> => {
      const done = new Set(menu.alreadyChecked.map((k) => k.camera));
      const next = menu.includedCameras.filter((c) => !done.has(c)).sort()[0];
      const [w0, w1] = menu.claim.window;
      return next
        ? { name: "inspect_window", args: { camera_id: next, start_s: w0, end_s: w1, crop: "entity", reason: "next camera" }, tokens: 0, costUsd: 0, latencyMs: 0 }
        : { name: "stop", args: { reason: "done" }, tokens: 0, costUsd: 0, latencyMs: 0 };
    };
    const r = await runKillTestH("offline", alphabetical);
    expect(r.rows.find((x) => x.claimId === "w2")).toMatchObject({ initial: "Contradicted", final: "Contradicted", steps: "inspect A, inspect B, stop" });
    expect(r.rightChanged).toBe(0); // still safe, just less useful
    expect(r.newContradicted).toBe(0);
  });

  it("lists each rejected step's reason and the camera/window the agent sent, under the claim's row", async () => {
    // First call out of range (rejected, uses a check), second call malformed (rejected), then forced stop.
    let n = 0;
    const clumsy = async ({ menu }: TurnInput): Promise<TurnOutput> => {
      n++;
      const usage = { tokens: 0, costUsd: 0, latencyMs: 0 };
      if (n % 2 === 1) {
        const [, w1] = menu.claim.window;
        return { name: "inspect_window", args: { camera_id: "A", start_s: w1 + 20, end_s: w1 + 22, crop: "full", reason: "far away" }, ...usage };
      }
      return { name: "inspect_window", args: { camera_id: "Z" }, ...usage };
    };
    const r = await runKillTestH("offline", clumsy);
    const w1 = r.rows.find((x) => x.claimId === "w1")!;
    expect(w1.steps).toBe("rejected, rejected, stop");
    expect(w1.rejections).toEqual([
      { camera: "A", start: expect.any(Number), end: expect.any(Number), reason: expect.stringMatching(/outside the allowed range/) },
      { sent: 'Unparsed inspect_window call: {"camera_id":"Z"}', reason: expect.stringMatching(/Invalid inspect_window arguments.*camera_id/) },
    ]);

    const text = formatReport(r);
    const at = text.split("\n").findIndex((l) => l.startsWith("w1 "));
    const under = text.split("\n").slice(at + 1, at + 3);
    expect(under[0]).toMatch(/^\s+rejected: camera A \d+(\.\d+)?–\d+(\.\d+)? s: Window .* is outside the allowed range/);
    expect(under[1]).toMatch(/^\s+rejected: \(unparsed call\) Unparsed inspect_window call: \{"camera_id":"Z"\}: Invalid inspect_window arguments/);
    // Same pass/fail rules: nothing was downgraded, so it fails.
    expect(r.wrongDowngraded).toBe(0);
    expect(r.pass).toBe(false);
  });

  it("formats the report with the counts, PASS/FAIL and one line per claim", () => {
    const text = formatReport(report);
    expect(text).toMatch(/^H offline: safety checks only/);
    expect(text).toMatch(/right labels changed:\s+0 \(must be 0\)/);
    expect(text).toMatch(/new Contradicted:\s+0 \(must be 0\)/);
    expect(text).toMatch(/wrong labels downgraded: \d of 5 \(need >= 3\)/);
    expect(text).toMatch(/\nPASS\n/);
    expect(text.split("\n").filter((l) => /^(r|w)\d /.test(l))).toHaveLength(10);
    expect(text).not.toMatch(/rejected:/); // the fixed rule never makes a rejected call
    expect(text).not.toMatch(/tokens:/); // only shown in model mode
  });
});

describe("kill test H --save / --replay / --trace", () => {
  it("callsFromSteps keeps the agent's own calls and drops the loop's forced stops and model errors", () => {
    const base = { agent: "skeptic" as const, claimId: "r2", tokens: 0, costUsd: 0, latencyMs: 0 };
    const steps: AgentStep[] = [
      { ...base, n: 1, action: "rejected", args: { camera_id: "B", start_s: 18, end_s: 21, crop: "full", reason: "edge" }, rejectionReason: "Clip must overlap…" },
      { ...base, n: 2, action: "rejected", args: { reason: 'Unparsed inspect_window call: {"camera_id":"Z"}' }, rejectionReason: "Invalid…" },
      { ...base, n: 3, action: "inspect_window", args: { camera_id: "A", start_s: 21, end_s: 24, crop: "entity", reason: "look" } },
      { ...base, n: 4, action: "stop", args: { reason: "Forced stop: no follow-ups left (2 of 2 checks used)." } },
      { ...base, n: 5, action: "rejected", args: { reason: "model unavailable: 503" }, rejectionReason: "model unavailable: 503" },
      { ...base, n: 6, action: "stop", args: { reason: "Done." }, implicitStop: true },
    ];
    expect(callsFromSteps(steps)).toEqual([
      { tool: "inspect_window", camera: "B", start: 18, end: 21, crop: "full", reason: "edge" },
      { tool: "unparsed", raw: 'Unparsed inspect_window call: {"camera_id":"Z"}' },
      { tool: "inspect_window", camera: "A", start: 21, end: 24, crop: "entity", reason: "look" },
      { tool: "stop", reason: "Done.", implicit: true },
    ]);
  });

  it("replaying the saved calls of a run reproduces it exactly", async () => {
    const original = await runKillTestH("offline");
    const saved = savedCallsOf(original);
    expect(Object.keys(saved.claims)).toEqual(CLAIMS.map((c) => c.id));
    expect(saved.claims.r2).toEqual([
      expect.objectContaining({ tool: "inspect_window" }),
      expect.objectContaining({ tool: "inspect_window" }),
    ]);
    const replayed = await runKillTestH("replay", replayTurn(JSON.parse(JSON.stringify(saved)) as SavedCalls));
    expect(replayed.label).toBe("H replay (saved calls)");
    expect(replayed.rows.map(({ claimId, final, steps, calls }) => ({ claimId, final, steps, calls }))).toEqual(
      original.rows.map(({ claimId, final, steps, calls }) => ({ claimId, final, steps, calls })),
    );
  });

  it("a replayed unparsed call is rejected again, and running out of calls stops", async () => {
    const saved: SavedCalls = { savedAt: "", mode: "model", claims: { r1: [{ tool: "unparsed", raw: 'Unparsed inspect_window call: {"camera_id":"Z"}' }] } };
    const r = await runKillTestH("replay", replayTurn(saved));
    expect(r.rows.find((x) => x.claimId === "r1")).toMatchObject({ steps: "rejected, stop" });
    expect(r.rows.find((x) => x.claimId === "r1")!.rejections[0]!.reason).toMatch(/camera_id/);
    expect(r.rows.find((x) => x.claimId === "r3")!.steps).toBe("stop"); // no saved calls
  });

  it("traces r2 step by step: a usable clip past the claim window replaces the audit (0.935 -> 0.880) and r2 loses Contradicted", async () => {
    const saved: SavedCalls = {
      savedAt: "",
      mode: "replay",
      claims: {
        r2: [
          { tool: "inspect_window", camera: "A", start: 22, end: 26, crop: "entity", reason: "after the move" },
          { tool: "inspect_window", camera: "B", start: 21, end: 24, crop: "entity", reason: "B" },
        ],
      },
    };
    const r = await runKillTestH("replay", replayTurn(saved), { trace: "r2" });
    const t = r.trace!.join("\n");
    expect(t).toMatch(/^Trace r2: "Sam put the blue cup in zone D", claim window 21–24 s, starts Contradicted/);
    expect(t).toMatch(/step 1: inspect_window \{"camera_id":"A","start_s":22,"end_s":26/);
    expect(t).toMatch(/fake checkWindow A 22–26 s \(entity\) -> A 22–26 s vis 0\.907 sup 0\.049 con 0\.880/);
    expect(t).toMatch(/audit before: support 0\.049 contradict 0\.935/);
    expect(t).toMatch(/audit after: {2}support 0\.049 contradict 0\.880 .*\(REPLACED by this clip's audit\)/);
    expect(t).toMatch(/verdict\(\) -> Insufficient/);
    expect(t).toMatch(/audit contradict ≥ 0\.9 ✗ \(0\.880\)/);
    expect(t).toMatch(/\(kept: clip not usable\)/); // step 2: B is blocked, the audit stays
    expect(t).toMatch(/final: Insufficient/);
    // Same pass/fail rules: a right label changed.
    expect(r.rightChanged).toBeGreaterThanOrEqual(1);
    expect(r.pass).toBe(false);
    expect(formatReport(r)).toContain("Trace r2:");
  });
});
