export type ColorMode = 'light' | 'dark';
export type ThemePalette = {
  id: string;
  name: string;
  light: Record<string, string>;
  dark: Record<string, string>;
};
export type Theme = {
  id: string;
  name: string;
  preview: Record<ColorMode, Record<string, string>>;
  exclusive?: 'iphone';
};
