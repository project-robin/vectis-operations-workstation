"use client";

import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

type Mode = "light" | "dark";

const VectisThemeContext = createContext<{
  mode: Mode;
  setMode: (mode: Mode) => void;
} | null>(null);

export function VectisThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    try {
      if (globalThis.localStorage?.getItem("vectis-theme") === "dark") setMode("dark");
    } catch {
      // Private browsing can make local storage unavailable.
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === "vectis-theme") setMode(event.newValue === "dark" ? "dark" : "light");
    };
    globalThis.addEventListener("storage", onStorage);
    return () => globalThis.removeEventListener("storage", onStorage);
  }, []);

  const chooseMode = (next: Mode) => {
    setMode(next);
    document.documentElement.dataset.theme = next;
    try {
      globalThis.localStorage?.setItem("vectis-theme", next);
    } catch {
      // Appearance still changes for this session.
    }
  };

  return (
    <VectisThemeContext.Provider value={{ mode, setMode: chooseMode }}>
      <Theme theme={neutralTheme} mode={mode}>
        {/* Route Astryx links through Next so navigation stays client-side. */}
        <LinkProvider component={NextLink}>{children}</LinkProvider>
      </Theme>
    </VectisThemeContext.Provider>
  );
}

export function useVectisTheme() {
  const context = useContext(VectisThemeContext);
  if (!context) throw new Error("useVectisTheme must be used within VectisThemeProvider");
  return context;
}
