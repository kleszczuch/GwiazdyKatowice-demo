import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'gwiazdykatowice.theme';
const NAV_KEY = 'gwiazdykatowice.nav';
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (value: Theme) => void;
  navBottom: boolean;
  setNavBottom: (value: boolean) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      return;
    }
  }, [theme]);
  const [navBottom, setNavBottom] = useState(() => {
    try {
      return localStorage.getItem(NAV_KEY) === 'bottom';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.nav = navBottom ? 'bottom' : 'top';
    try {
      localStorage.setItem(NAV_KEY, navBottom ? 'bottom' : 'top');
    } catch {
      return;
    }
  }, [navBottom]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme, navBottom, setNavBottom }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeProvider is missing.');
  return context;
}
