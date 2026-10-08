import { describe, expect, it } from 'vitest';
import { parseAppearance, themes } from '../../src/lib/appearance';

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
  it('includes the complete upstream catalog with both color variants', () => {
    expect(themes).toHaveLength(37);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    for (const theme of themes) {
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(theme[mode]).length).toBeGreaterThan(250);
        expect(theme[mode]['background-base']).toMatch(/^#[\da-f]{6}$/i);
        expect(theme[mode]['text-base']).toMatch(/^#[\da-f]{6}$/i);
        expect(theme[mode]['markdown-text']).toBeTruthy();
      }
    }
  });
});
