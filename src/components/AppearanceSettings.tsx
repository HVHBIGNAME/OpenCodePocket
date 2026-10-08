import { useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Monitor, Moon, Palette, Search, Sun } from 'lucide-react';
import { themes, useAppearance, setAppearance, type Theme, type ColorMode } from '../lib/appearance';
import { usePocket } from '../store/PocketProvider';
import { Button, Modal } from './ui';
import './appearance.css';

function Swatch({ theme, mode }: { theme: Theme; mode: ColorMode }) {
  const tokens = theme[mode];
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={
        {
          '--preview-bg': tokens['background-base'],
          '--preview-text': tokens['text-strong'],
          '--preview-primary': tokens['text-interactive-base'],
          '--preview-success': tokens['icon-success-base'],
          '--preview-border': tokens['border-base'],
        } as CSSProperties
      }
    >
      <i />
      <i />
      <i />
    </span>
  );
}

export function AppearanceSettings() {
  const appearance = useAppearance();
  const { perform } = usePocket();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = themes.find((theme) => theme.id === appearance.theme)!;
  const matches = themes.filter((theme) =>
    `${theme.name} ${theme.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const change = (patch: Parameters<typeof setAppearance>[0]) =>
    void perform(async () => setAppearance(patch));
  return (
    <section className="panel settings-section appearance-section">
      <div className="settings-section-title">
        <Palette size={20} />
        <div>
          <h2>Оформление</h2>
          <p>Все {themes.length} тем OpenCode с оригинальными цветами.</p>
        </div>
      </div>
      <div className="segmented appearance-modes" role="group" aria-label="Цветовой режим">
        {(
          [
            ['light', 'Светлая', Sun],
            ['dark', 'Тёмная', Moon],
            ['system', 'Системная', Monitor],
          ] as const
        ).map(([scheme, name, Icon]) => (
          <button
            key={scheme}
            aria-pressed={appearance.scheme === scheme}
            className={appearance.scheme === scheme ? 'active' : ''}
            onClick={() => change({ scheme })}
          >
            <Icon size={16} />
            {name}
          </button>
        ))}
      </div>
      <button
        className="settings-link-row theme-current"
        aria-label={`Тема: ${selected.name}`}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <Swatch theme={selected} mode={appearance.mode} />
        <span>
          <strong>{selected.name}</strong>
          <small>Выбрать тему OpenCode</small>
        </span>
        <ChevronRight size={18} />
      </button>
      {open && (
        <Modal
          title="Темы OpenCode"
          subtitle={`${themes.length} тем · оригинальные светлые и тёмные палитры`}
          onClose={() => setOpen(false)}
        >
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Поиск тем"
              placeholder="Найти тему…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="theme-catalog" role="group" aria-label="Каталог тем">
            {matches.map((theme) => (
              <button
                key={theme.id}
                className={`theme-option ${theme.id === appearance.theme ? 'selected' : ''}`}
                aria-pressed={theme.id === appearance.theme}
                aria-label={theme.name}
                onClick={() => change({ theme: theme.id })}
              >
                <Swatch theme={theme} mode={appearance.mode} />
                <span>{theme.name}</span>
                {theme.id === appearance.theme && <Check size={18} />}
              </button>
            ))}
          </div>
          {!matches.length && <p className="form-hint">Темы с таким названием нет.</p>}
          <Button className="theme-done" onClick={() => setOpen(false)}>
            Готово
            <Check size={18} />
          </Button>
        </Modal>
      )}
    </section>
  );
}
