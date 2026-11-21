// OWNER: Dev 4. Which routes wear the cinematic shell, and the nav tabs.

/** Routes that wear the cinematic shell (nav, grain, glow). Other pages (/phone, /label) keep their own look. */
export function isSitePath(pathname: string): boolean {
  if (pathname === "/") return true;
  return ["/new", "/capture", "/board", "/proof", "/results"].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Which nav tab a path belongs to, for the sliding active pill. */
export const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/capture", label: "Capture" },
  { href: "/board", label: "Board" },
  { href: "/proof", label: "Proof" },
  { href: "/results", label: "Benchmark" },
] as const;

export function navIndex(pathname: string): number {
  if (pathname === "/") return 0;
  const i = NAV_ITEMS.findIndex((n) => n.href !== "/" && (pathname === n.href || pathname.startsWith(`${n.href}/`)));
  return i < 0 ? -1 : i;
}
