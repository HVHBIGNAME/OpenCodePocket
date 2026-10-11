import { useState, type CSSProperties } from 'react';
import { Check, ChevronRight, LoaderCircle, Monitor, Moon, Palette, Search, Sun } from 'lucide-react';
import {
  availableThemes,
  themes,
  useAppearance,
  setAppearance,
  type Theme,
  type ColorMode,
} from '../lib/appearance';
import { usePocket } from '../store/PocketProvider';
import { Button, Modal, Toggle } from './ui';
import './appearance.css';

function Swatch({ theme, mode }: { theme: Theme; mode: ColorMode }) {
  const tokens = theme.preview[mode];
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
  const selected = availableThemes.find((theme) => theme.id === appearance.theme)!;
  const matches = availableThemes.filter((theme) =>
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
          <p>
            {themes.length} тем OpenCode
            {availableThemes.length > themes.length ? ' + Liquid Glass для iPhone' : ''}.
          </p>
        </div>
      </div>
      <fieldset className="segmented appearance-modes" aria-label="Цветовой режим">
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
      </fieldset>
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
          <small>{appearance.pending ? 'Применяем тему…' : 'Выбрать оформление'}</small>
        </span>
        <ChevronRight size={18} />
      </button>
      {selected.exclusive === 'iphone' && (
        <>
          <p className="form-hint glass-description">
            Системное стекло панелей на iOS 26+. На ранних iOS и в браузере — прозрачное оформление WebView.
          </p>
          <Toggle
            checked={Boolean(appearance.reduceTransparency)}
            onChange={(reduceTransparency) => change({ reduceTransparency })}
            label="Уменьшить прозрачность"
            description="Плотные поверхности и повышенная читаемость. Системные настройки доступности учитываются автоматически."
          />
        </>
      )}
      {open && (
        <Modal
          title="Темы оформления"
          subtitle={`${themes.length} оригинальных тем OpenCode${availableThemes.length > themes.length ? ' · эксклюзив iPhone' : ''}`}
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
          <fieldset className="theme-catalog" aria-label="Каталог тем">
            {matches.map((theme) => (
              <button
                key={theme.id}
                className={`theme-option ${theme.id === appearance.theme ? 'selected' : ''}`}
                aria-pressed={theme.id === appearance.theme}
                aria-label={theme.name}
                onClick={() => change({ theme: theme.id })}
              >
                <Swatch theme={theme} mode={appearance.mode} />
                <span>
                  {theme.name}
                  {theme.exclusive && <small className="theme-exclusive">iPhone</small>}
                </span>
                {theme.id === appearance.pending ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  theme.id === appearance.theme && <Check size={18} />
                )}
              </button>
            ))}
          </fieldset>
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
