import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'thai.theme'

type Listener = () => void
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener()
}

function isTheme(value: string | null): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** The persisted setting: 'system' | 'light' | 'dark'. Defaults to 'system'
 * when nothing is stored, or localStorage is unavailable. */
export function getTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** The theme actually in effect right now: 'system' resolves to the OS
 * preference. */
export function getResolvedTheme(theme: Theme = getTheme()): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme
  return prefersDark() ? 'dark' : 'light'
}

function applyTheme(theme: Theme): void {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = theme
  }
}

/** Persists the setting, applies (or clears) `data-theme` on `<html>`
 * immediately, and notifies every mounted `useTheme()`. */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // localStorage unavailable (private mode, disabled) - the theme still
    // applies for the rest of this session, it just won't persist.
  }
  applyTheme(theme)
  notify()
}

export interface UseThemeResult {
  /** The persisted setting. */
  theme: Theme
  /** What's actually applied right now ('system' resolved via the OS). */
  resolvedTheme: ResolvedTheme
  setTheme: typeof setTheme
}

/** Reads the current theme setting and keeps it in sync: with other calls
 * to `setTheme` (including from other components), and - when the setting
 * is 'system' - with OS-level light/dark changes. */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    getResolvedTheme(theme),
  )

  useEffect(() => {
    const sync = () => {
      const current = getTheme()
      setThemeState(current)
      setResolvedTheme(getResolvedTheme(current))
    }

    sync()
    listeners.add(sync)

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', sync)

    return () => {
      listeners.delete(sync)
      media.removeEventListener('change', sync)
    }
  }, [])

  return { theme, resolvedTheme, setTheme }
}
