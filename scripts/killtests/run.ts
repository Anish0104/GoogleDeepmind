// OWNER: Dev 3. Usage: pnpm killtest <a-h>
// Owners: a, e, f = Dev 1 · b, c, d = Dev 2 · g, h = Dev 3
export {};

const letter = (process.argv[2] ?? "").toLowerCase();
const valid = ["a", "b", "c", "d", "e", "f", "g", "h"];

if (!valid.includes(letter)) {
  console.error(`Usage: pnpm killtest <${valid.join("|")}>`);
  process.exit(1);
}

const mod: { main: () => Promise<void> } = await import(`./${letter}.ts`);
await mod.main();
