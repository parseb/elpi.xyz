"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getThemeSnapshot(): Theme {
  const saved = localStorage.getItem("elpi_theme") || localStorage.getItem("optionhood_theme");
  return saved === "light" || saved === "dark" ? saved : "dark";
}

function getServerThemeSnapshot(): Theme {
  return "dark";
}

function getMountedSnapshot(): boolean {
  return true;
}

function getServerMountedSnapshot(): boolean {
  return false;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerThemeSnapshot);
  const mounted = useSyncExternalStore(subscribe, getMountedSnapshot, getServerMountedSnapshot);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem("elpi_theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    window.dispatchEvent(new Event("storage"));
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useTheme();

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Switch theme"
        className="inline-flex h-9 w-9 sm:w-[76px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 sm:px-3 text-xs font-semibold text-[var(--foreground)]"
      >
        <span className="flex items-center gap-1.5 opacity-0">
          <SunIcon size={16} />
          <span className="hidden sm:inline">Light</span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 sm:px-3 text-xs font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--surface-overlay)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] cursor-pointer"
    >
      {theme === "dark" ? (
        <span className="flex items-center gap-1.5">
          <SunIcon size={16} className="text-[var(--amber-text)]" />
          <span className="hidden sm:inline">Light</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <MoonIcon size={16} className="text-[var(--base-blue-light)]" />
          <span className="hidden sm:inline">Dark</span>
        </span>
      )}
    </button>
  );
}

