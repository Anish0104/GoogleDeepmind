// OWNER: Dev 4. Test helper: a CanvasRenderingContext2D stand-in that records calls,
// so canvas renderers can be smoke-tested in Node without a browser.
export interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  calls: string[];
}

export function fakeCtx(): FakeCtx {
  const calls: string[] = [];
  const gradient = { addColorStop: () => undefined };
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "createLinearGradient" || key === "createRadialGradient") {
        return () => gradient;
      }
      if (key === "measureText") return (s: string) => ({ width: s.length * 6 });
      return (...args: unknown[]) => {
        calls.push(String(key));
        void args;
      };
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
