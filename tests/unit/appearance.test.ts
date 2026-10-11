import { describe, expect, it } from 'vitest';
import { parseAppearance, themes } from '../../src/lib/appearance';
import { loadTheme } from '../../src/themes/loader';

describe('appearance preferences', () => {
  it('restores known themes and resolves the system color scheme', () => {
    expect(parseAppearance({ theme: 'catppuccin', scheme: 'system' }, false)).toEqual({
      theme: 'catppuccin',
      scheme: 'system',
      mode: 'light',
    });
    expect(parseAppearance({ theme: 'github', scheme: 'light' }, true).mode).toBe('light');
    expect(parseAppearance({ theme: 'amoled', scheme: 'system' }, true).mode).toBe('dark');
  });
  it('recovers from obsolete or invalid stored preferences', () => {
    for (const value of [null, 'dark', {}, { theme: 'missing', scheme: 'invalid' }]) {
      expect(parseAppearance(value, false)).toEqual({ theme: 'mercury', scheme: 'dark', mode: 'dark' });
    }
  });
  it('loads the complete upstream catalog with both color variants on demand', async () => {
    expect(themes).toHaveLength(37);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    for (const theme of themes) {
      const palette = await loadTheme(theme.id);
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(palette[mode]).length).toBeGreaterThan(250);
        expect(palette[mode]['background-base']).toMatch(/^#[\da-f]{6}$/i);
        expect(palette[mode]['text-base']).toMatch(/^#[\da-f]{6}$/i);
        expect(palette[mode]['markdown-text']).toBeTruthy();
      }
    }
  });
});
