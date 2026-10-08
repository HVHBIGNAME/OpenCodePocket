import { useSyncExternalStore } from 'react';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';
import catalog from '../themes/catalog.json';
import { isNative, platform } from './native';

export type ColorMode = 'light' | 'dark';
export type ColorScheme = ColorMode | 'system';
export type Appearance = { theme: string; scheme: ColorScheme; mode: ColorMode };
export type Theme = { id: string; name: string; light: Record<string, string>; dark: Record<string, string> };
export const themes: Theme[] = catalog.themes;
export const themeRevision = catalog.revision;
export const APPEARANCE_KEY = 'occ.appearance';
export const defaultTheme = themes.find((theme) => theme.id === 'mercury')!;
let current: Appearance = { theme: defaultTheme.id, scheme: 'dark', mode: 'dark' };
let initialized = false;
let appliedTokens: string[] = [];
let nativeUpdate = Promise.resolve();
const listeners = new Set<() => void>();

export function parseAppearance(value: unknown, systemDark: boolean): Appearance {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const theme = themes.some((entry) => entry.id === saved.theme) ? String(saved.theme) : defaultTheme.id;
  const scheme = saved.scheme === 'light' || saved.scheme === 'system' ? saved.scheme : 'dark';
  return { theme, scheme, mode: scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme };
}

function readAppearance(): Appearance {
  let value: unknown;
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    value = stored ? JSON.parse(stored) : undefined;
  } catch (error) {
    console.warn('Appearance preferences could not be read', error instanceof Error ? error.name : 'Error');
  }
  return parseAppearance(value, window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function apply(appearance: Appearance) {
  current = appearance;
  const theme = themes.find((entry) => entry.id === appearance.theme) ?? defaultTheme;
  const tokens = theme[appearance.mode];
  const root = document.documentElement;
  for (const key of appliedTokens) root.style.removeProperty(`--${key}`);
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
  appliedTokens = Object.keys(tokens);
  root.dataset.theme = theme.id;
  root.dataset.colorMode = appearance.mode;
  root.style.colorScheme = appearance.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['background-base']!);
  for (const listener of listeners) listener();
  if (isNative) {
    nativeUpdate = nativeUpdate
      .then(async () => {
        await SystemBars.setStyle({
          style: appearance.mode === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        });
        if (platform === 'ios')
          await Keyboard.setStyle({
            style: appearance.mode === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light,
          });
      })
      .catch((error: unknown) => {
        console.warn('Native appearance could not be updated', error instanceof Error ? error.name : 'Error');
      });
  }
}

export function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  apply(readAppearance());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (current.scheme === 'system') apply({ ...current, mode: event.matches ? 'dark' : 'light' });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY || event.key === null) apply(readAppearance());
  });
}

export function setAppearance(patch: Partial<Pick<Appearance, 'theme' | 'scheme'>>) {
  const next = parseAppearance(
    { ...current, ...patch },
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ theme: next.theme, scheme: next.scheme }));
  apply(next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useAppearance() {
  return useSyncExternalStore(subscribe, () => current);
}
