"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  isMounted: boolean;
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    // Graceful fallback for components rendered outside provider in tests
    return {
      theme: "dark",
      toggleTheme: () => {},
      setTheme: () => {},
      isMounted: false,
    };
  }
  return ctx;
}

export const STORAGE_KEY = "vera-theme";

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [isMounted, setIsMounted] = useState(false);

  // Initialize theme from localStorage or system preference
  useEffect(() => {
    setIsMounted(true);
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "dark" || stored === "light") {
        setThemeState(stored);
        document.documentElement.setAttribute("data-theme", stored);
        document.body.setAttribute("data-theme", stored);
      } else {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const initial = prefersDark ? "dark" : "dark"; // Default to dark for cinematic vibe
        setThemeState(initial);
        document.documentElement.setAttribute("data-theme", initial);
        document.body.setAttribute("data-theme", initial);
      }
    } catch {
      // Storage access may fail in restricted iframes
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore
    }
    document.documentElement.setAttribute("data-theme", next);
    document.body.setAttribute("data-theme", next);
    window.dispatchEvent(new CustomEvent("vera-theme-change", { detail: { theme: next } }));
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore
      }
      document.documentElement.setAttribute("data-theme", next);
      document.body.setAttribute("data-theme", next);
      window.dispatchEvent(new CustomEvent("vera-theme-change", { detail: { theme: next } }));
      return next;
    });
  }, []);

  // Keyboard shortcut: Shift + D to toggle theme
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "D" || e.key === "d")) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme]);

  const value = useMemo(
    () => ({ theme, toggleTheme, setTheme, isMounted }),
    [theme, toggleTheme, setTheme, isMounted],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
