import mercury from './palettes/mercury.json';
import type { Theme, ThemePalette } from './types';

export const liquidGlass: ThemePalette = {
  id: 'liquid-glass',
  name: 'Liquid Glass',
  light: {
    ...mercury.light,
    'background-base': '#eaf0f8',
    'background-strong': '#f5f8fc',
    'surface-base': '#f3f6fb',
    'surface-raised-base': '#ffffff',
    'input-base': '#f8fafc',
    'text-base': '#223047',
    'text-strong': '#101b30',
    'text-weak': '#4c5a70',
    'text-interactive-base': '#145acc',
    'icon-interactive-base': '#145acc',
    'border-base': '#becbdc',
    'border-interactive-base': '#326ed6',
  },
  dark: {
    ...mercury.dark,
    'background-base': '#101b2b',
    'background-strong': '#152337',
    'surface-base': '#18263a',
    'surface-raised-base': '#22334b',
    'input-base': '#142033',
    'text-base': '#e1eaf9',
    'text-strong': '#f7faff',
    'text-weak': '#adbdd4',
    'text-interactive-base': '#a1c7ff',
    'icon-interactive-base': '#a1c7ff',
    'border-base': '#455771',
    'border-interactive-base': '#94bfff',
  },
};

export const liquidGlassDescriptor: Theme = {
  id: liquidGlass.id,
  name: liquidGlass.name,
  exclusive: 'iphone',
  preview: { light: liquidGlass.light, dark: liquidGlass.dark },
};
