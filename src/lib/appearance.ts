import { useSyncExternalStore } from 'react';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';
import { isNative, platform } from './native';
import { availableThemes, defaultPalette, loadTheme } from '../themes/loader';
import type { ColorMode, ThemePalette } from '../themes/types';
export { themes, availableThemes, themeRevision } from '../themes/loader';
export type { Theme, ColorMode } from '../themes/types';

export type ColorScheme = ColorMode | 'system';
export type Appearance = {
  theme: string;
  scheme: ColorScheme;
  mode: ColorMode;
  reduceTransparency?: boolean;
  pending?: string;
};
export const APPEARANCE_KEY = 'occ.appearance';
export const defaultTheme = availableThemes.find((theme) => theme.id === 'mercury')!;
let current: Appearance = { theme: defaultTheme.id, scheme: 'dark', mode: 'dark' };
let desired = current;
let sequence = 0;
let initialized = false;
let appliedTokens: string[] = [];
let nativeUpdate = Promise.resolve();
const listeners = new Set<() => void>();

export function parseAppearance(value: unknown, systemDark: boolean): Appearance {
  const saved = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const theme = availableThemes.some((entry) => entry.id === saved.theme)
    ? String(saved.theme)
    : defaultTheme.id;
  const scheme = saved.scheme === 'light' || saved.scheme === 'system' ? saved.scheme : 'dark';
  return {
    theme,
    scheme,
    mode: scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme,
    ...(saved.reduceTransparency === true ? { reduceTransparency: true } : {}),
  };
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

function apply(appearance: Appearance, theme: ThemePalette) {
  current = appearance;
  const tokens = theme[appearance.mode];
  const root = document.documentElement;
  for (const key of appliedTokens) root.style.removeProperty(`--${key}`);
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
  appliedTokens = Object.keys(tokens);
  root.dataset.theme = theme.id;
  root.dataset.colorMode = appearance.mode;
  root.dataset.reduceTransparency = String(Boolean(appearance.reduceTransparency));
  root.style.colorScheme = appearance.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['background-base']!);
  for (const listener of listeners) listener();
  if (isNative) {
    nativeUpdate = nativeUpdate
      .then(async () => {
        if (current.mode !== appearance.mode) return;
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

async function change(next: Appearance, persist: boolean) {
  if (persist)
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ theme: next.theme, scheme: next.scheme, reduceTransparency: next.reduceTransparency }),
    );
  const request = ++sequence;
  desired = next;
  current = { ...current, pending: next.theme };
  for (const listener of listeners) listener();
  try {
    const palette = await loadTheme(next.theme);
    if (request !== sequence) return;
    apply(next, palette);
  } catch (error) {
    if (request !== sequence) return;
    const { pending: _pending, ...previous } = current;
    current = previous;
    desired = previous;
    for (const listener of listeners) listener();
    throw error;
  }
}

export async function initializeAppearance() {
  if (initialized) return;
  initialized = true;
  apply(current, defaultPalette);
  const restore = () =>
    change(readAppearance(), false).catch((error: unknown) =>
      console.warn('Appearance could not be restored', error instanceof Error ? error.name : 'Error'),
    );
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (desired.scheme === 'system')
      void change({ ...desired, mode: event.matches ? 'dark' : 'light' }, false).catch((error: unknown) =>
        console.warn('System appearance update failed', error instanceof Error ? error.name : 'Error'),
      );
  });
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY || event.key === null) void restore();
  });
  await restore();
}

export function setAppearance(patch: Partial<Pick<Appearance, 'theme' | 'scheme' | 'reduceTransparency'>>) {
  const next = parseAppearance(
    { ...desired, ...patch },
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  return change(next, true);
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
