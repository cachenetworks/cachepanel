'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Theme persists in localStorage. The matching inline <script> in layout.tsx
// sets data-theme before React hydrates so there's no flash of the wrong
// theme on first paint.

const STORAGE_KEY = 'cachepanel.theme';
type Theme = 'dark' | 'light';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // First visit: respect OS preference.
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<Theme>('dark');

  React.useEffect(() => {
    const t = readTheme();
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);

  const toggle = React.useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // localStorage can throw in private mode — just keep the in-memory state.
      }
      return next;
    });
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
