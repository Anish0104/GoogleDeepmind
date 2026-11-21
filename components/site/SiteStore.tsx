// OWNER: Dev 4. Shared client state for the cinematic shell: the board's replay clock,
// the excluded cameras and the Capture animations. It lives in the root layout so it
// survives route changes (the nav chip shows the clock on every screen).
"use client";

import { usePathname } from "next/navigation";
import {
  type MutableRefObject,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CameraId } from "@/lib/types";
import type { ReplayTimeline } from "@/components/replay/timeline";

export interface Pointer {
  x: number;
  y: number;
  mx: number; // -0.5..0.5 of the viewport
  my: number;
  mxs: number; // smoothed (lerp 0.05 per frame)
  mys: number;
}

export interface SiteStore {
  // replay clock
  tRef: MutableRefObject<number>;
  T: number;
  playing: boolean;
  foot: number;
  end: number;
  setBounds: (foot: number, end: number) => void;
  seek: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  restart: () => void;
  autoplayBoard: boolean;
  // board scene state shared with the nav chip
  excluded: CameraId[];
  setExcluded: (next: CameraId[]) => void;
  timeline: ReplayTimeline | null;
  setTimeline: (tl: ReplayTimeline | null) => void;
  sceneKey: MutableRefObject<string | null>;
  // capture animations
  sync: number;
  syncing: boolean;
  split: number;
  splitting: boolean;
  run: number;
  running: boolean;
  splitTotal: MutableRefObject<number>;
  startSync: () => void;
  startSplit: () => void;
  startRun: () => void;
  // pointer
  pointer: MutableRefObject<Pointer>;
}

const Ctx = createContext<SiteStore | null>(null);

export function useSite(): SiteStore {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSite must be used inside <SiteStoreProvider>");
  return s;
}

export function SiteStoreProvider({
  children,
  playbackSpeed = 1,
  autoplayBoard = true,
}: {
  children: ReactNode;
  playbackSpeed?: number;
  autoplayBoard?: boolean;
}) {
  const pathname = usePathname();

  const tRef = useRef(0);
  const [T, setTState] = useState(0);
  const shownT = useRef(0);
  const setT = useCallback((t: number) => {
    shownT.current = t;
    setTState(t);
  }, []);
  const [playing, setPlayingState] = useState(false);
  const playingRef = useRef(false);
  const [bounds, setBoundsState] = useState({ foot: 22, end: 35 });
  const boundsRef = useRef(bounds);

  const [excluded, setExcluded] = useState<CameraId[]>([]);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const sceneKey = useRef<string | null>(null);

  const [cap, setCap] = useState({ sync: 0, syncing: false, split: 0, splitting: false, run: 0, running: false });
  const capRef = useRef(cap);
  capRef.current = cap;
  const splitTotal = useRef(140);

  const pointer = useRef<Pointer>({ x: -9999, y: -9999, mx: 0, my: 0, mxs: 0, mys: 0 });

  const setPlaying = useCallback((p: boolean) => {
    playingRef.current = p;
    setPlayingState(p);
  }, []);

  const setBounds = useCallback((foot: number, end: number) => {
    if (boundsRef.current.foot === foot && boundsRef.current.end === end) return;
    boundsRef.current = { foot, end };
    setBoundsState({ foot, end });
    if (tRef.current > end) {
      tRef.current = end;
      setT(end);
    }
  }, []);

  const seek = useCallback((t: number) => {
    tRef.current = Math.max(0, Math.min(boundsRef.current.end, t));
    setT(tRef.current);
  }, []);

  const togglePlay = useCallback(() => {
    if (tRef.current >= boundsRef.current.end - 0.01) {
      tRef.current = 0;
      setT(0);
    }
    setPlaying(!playingRef.current);
  }, [setPlaying]);

  const restart = useCallback(() => {
    tRef.current = 0;
    setT(0);
    setPlaying(true);
  }, [setPlaying]);

  const startSync = useCallback(() => setCap((c) => ({ ...c, sync: 0, syncing: true })), []);
  const startSplit = useCallback(() => setCap((c) => ({ ...c, split: 0, splitting: true })), []);
  const startRun = useCallback(() => setCap((c) => ({ ...c, run: 0, running: true })), []);

  // pointer
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const p = pointer.current;
      p.x = e.clientX;
      p.y = e.clientY;
      p.mx = e.clientX / window.innerWidth - 0.5;
      p.my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // the one ticker: clock, capture progress, pointer smoothing
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const p = pointer.current;
      p.mxs += (p.mx - p.mxs) * 0.05;
      p.mys += (p.my - p.mys) * 0.05;

      if (playingRef.current) {
        const end = boundsRef.current.end;
        tRef.current = Math.min(end, tRef.current + dt * playbackSpeed);
        if (tRef.current >= end) {
          setPlaying(false);
          setT(end);
        }
      }
      if (Math.abs(tRef.current - shownT.current) > 0.04) {
        shownT.current = tRef.current;
        setT(tRef.current);
      }

      const c = capRef.current;
      if (c.syncing || c.splitting || c.running) {
        const n = { ...c };
        if (c.syncing) {
          n.sync = Math.min(1, c.sync + dt * 0.55);
          if (n.sync >= 1) n.syncing = false;
        }
        if (c.splitting) {
          n.split = c.split + dt * 48;
          if (n.split >= splitTotal.current) n.splitting = false;
        }
        if (c.running) {
          n.run = Math.min(6, c.run + dt * 1.25);
          if (n.run >= 6) n.running = false;
        }
        capRef.current = n;
        setCap(n);
      }

    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playbackSpeed, setPlaying]);

  // leaving the board keeps the clock where it is; scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const value = useMemo<SiteStore>(
    () => ({
      tRef,
      T,
      playing,
      foot: bounds.foot,
      end: bounds.end,
      setBounds,
      seek,
      setPlaying,
      togglePlay,
      restart,
      autoplayBoard,
      excluded,
      setExcluded,
      timeline,
      setTimeline,
      sceneKey,
      ...cap,
      splitTotal,
      startSync,
      startSplit,
      startRun,
      pointer,
    }),
    [T, playing, bounds, setBounds, seek, setPlaying, togglePlay, restart, autoplayBoard, excluded, timeline, cap, startSync, startSplit, startRun],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
