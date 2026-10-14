import manifest from './manifest.json';
import mercury from './palettes/mercury.json';
import type { Theme, ThemePalette } from './types';

export const themes: Theme[] = manifest.themes;
export const themeRevision = manifest.revision;
export const defaultPalette: ThemePalette = mercury;
export const isIPhone = typeof navigator !== 'undefined' && /iPhone/.test(navigator.userAgent);
export const availableThemes = themes;

const imports = import.meta.glob<{ default: ThemePalette }>('./palettes/*.json');
const loaded = new Map<string, Promise<ThemePalette>>();

export function loadTheme(id: string): Promise<ThemePalette> {
  if (id === mercury.id) return Promise.resolve(mercury);
  const cached = loaded.get(id);
  if (cached) return cached;
  const loader = imports[`./palettes/${id}.json`];
  if (!loader) return Promise.reject(new Error('Тема недоступна'));
  const task = loader()
    .then((module) => module.default)
    .catch((error: unknown) => {
      loaded.delete(id);
      throw error;
    });
  loaded.set(id, task);
  return task;
}
