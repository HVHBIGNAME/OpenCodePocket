import { useEffect, useState } from 'react';
import { PageDeck, usePageActive } from '../components/PageDeck';
import {
  AudioLines,
  ArrowLeft,
  Bell,
  Bug,
  Check,
  ChevronRight,
  GitBranch as Github,
  KeyRound,
  Laptop,
  Link2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Palette,
  Download,
  Zap,
} from 'lucide-react';
import { z } from 'zod';
import { APP_VERSION } from '../../shared/protocol';
import { usePocket } from '../store/PocketProvider';
import { Button, ExternalLink, IconButton, Modal, Toggle } from '../components/ui';
import type { Config, Device } from '../types';
import { DiagnosticSettings } from '../components/DiagnosticSettings';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { NotificationSettings } from '../components/NotificationSettings';
import { UpdateSettings } from '../components/UpdateSettings';
import { availableThemes, useAppearance } from '../lib/appearance';

const settingSections = {
  appearance: { title: 'Оформление', icon: Palette, hint: 'Тема и цветовой режим' },
  notifications: { title: 'Уведомления', icon: Bell, hint: 'Ответы и события сессий' },
  voice: { title: 'Голосовой ввод', icon: AudioLines, hint: 'Язык и распознавание речи' },
  interface: { title: 'Интерфейс', icon: Smartphone, hint: 'Тактильный отклик' },
  connection: { title: 'Подключение', icon: Laptop, hint: 'Компьютеры и устройства' },
  permissions: { title: 'Разрешения OpenCode', icon: ShieldCheck, hint: 'Доступ к файлам и инструментам' },
  updates: { title: 'Обновления', icon: Download, hint: `Версия ${APP_VERSION}` },
  diagnostics: { title: 'Автоотчёты об ошибках', icon: Bug, hint: 'Диагностика и отправка отчётов' },
} as const;
type SettingsSection = keyof typeof settingSections;

const permissionSchema = z.union([
  z.enum(['ask', 'allow', 'deny']),
  z.record(
    z.string(),
    z.union([z.enum(['ask', 'allow', 'deny']), z.record(z.string(), z.enum(['ask', 'allow', 'deny']))]),
  ),
]);
const tools = [
  ['read', 'Чтение файлов'],
  ['edit', 'Изменение файлов'],
  ['bash', 'Команды терминала'],
  ['webfetch', 'Веб-запросы'],
  ['task', 'Запуск подзадач'],
  ['external_directory', 'Внешние папки'],
] as const;

function permissionPreset(mode: 'ask' | 'allow'): Config['permission'] {
  return { read: 'allow', edit: mode, bash: 'ask', task: mode, webfetch: mode, external_directory: 'ask' };
}

export function Settings() {
  const active = usePageActive();
  const { client, setScreen, setConnectOpen, status } = usePocket();
  const appearance = useAppearance();
  const [section, setSection] = useState<SettingsSection>();
  useEffect(() => {
    if (!section || !active) return;
    const back = (event: Event) => {
      event.preventDefault();
      setSection(undefined);
    };
    document.addEventListener('pocket:navigate-back', back);
    return () => document.removeEventListener('pocket:navigate-back', back);
  }, [section, active]);
  return (
    <PageDeck name="settings" pageKey={section ?? 'index'} scroll onBack={() => setSection(undefined)}>
      {section ? (
        <SettingsContent section={section} onBack={() => setSection(undefined)} />
      ) : (
        <div className="page settings-page">
          <div className="page-heading">
            <h1>Настройки</h1>
          </div>
          <button className="settings-workspace" onClick={() => setConnectOpen(true)}>
            <span className="settings-workspace-icon">
              <Laptop size={25} />
            </span>
            <span>
              <strong>{client?.connection.name ?? 'Подключить компьютер'}</strong>
              <small>
                {!client
                  ? 'Работайте с вашим OpenCode'
                  : status === 'live'
                    ? 'На связи'
                    : status === 'offline'
                      ? 'Нет соединения'
                      : 'Подключаемся…'}
              </small>
            </span>
            <ChevronRight size={19} />
          </button>
          {(
            [
              ['Приложение', ['appearance', 'notifications', 'voice', 'interface']],
              ['OpenCode', ['connection', 'permissions']],
              ['Поддержка', ['updates', 'diagnostics']],
            ] as const
          ).map(([title, entries]) => (
            <section className="settings-group" key={title} aria-label={title}>
              <h2>{title}</h2>
              <div className="settings-menu">
                {entries.map((id) => {
                  const { title, icon: Icon, hint } = settingSections[id];
                  return (
                    <button
                      className="settings-menu-row"
                      aria-label={title}
                      key={id}
                      onClick={() => {
                        setSection(id);
                      }}
                    >
                      <span className={`settings-menu-icon settings-icon-${id}`}>
                        <Icon size={20} />
                      </span>
                      <span>
                        <strong>{title}</strong>
                        <small>
                          {id === 'appearance'
                            ? `${availableThemes.find((theme) => theme.id === appearance.theme)?.name ?? appearance.theme} · ${appearance.scheme === 'system' ? 'Как на устройстве' : appearance.mode === 'dark' ? 'Тёмная' : 'Светлая'}`
                            : hint}
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  );
                })}
                {title === 'OpenCode' && (
                  <button className="settings-menu-row" onClick={() => setScreen('models')}>
                    <span className="settings-menu-icon">
                      <KeyRound size={20} />
                    </span>
                    <span>
                      <strong>Модели и API-ключи</strong>
                      <small>Провайдеры и параметры моделей</small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                )}
              </div>
            </section>
          ))}
          <footer className="settings-footer">
            <span>OpenCode Pocket · {APP_VERSION}</span>
            <ExternalLink href="https://github.com/HVHBIGNAME/OpenCodePocket">
              <Github size={15} />
              Исходный код
            </ExternalLink>
          </footer>
        </div>
      )}
    </PageDeck>
  );
}

function SettingsContent({ section, onBack }: { section: SettingsSection; onBack: () => void }) {
  const { client, preferences, setPreferences, setConnectOpen, config, saveConfig, perform } = usePocket();
  const [pendingPermission, setPendingPermission] = useState<Config['permission']>();
  const [advanced, setAdvanced] = useState(false);
  const [devices, setDevices] = useState(false);
  const [permissionEdits, setPermissionEdits] = useState<Record<string, 'ask' | 'allow' | 'deny'>>({});
  useEffect(() => setPermissionEdits({}), [config.permission]);
  const permission = config.permission;
  return (
    <div className="page settings-page settings-detail">
      <div className="page-heading">
        <IconButton label="Назад к настройкам" onClick={onBack}>
          <ArrowLeft size={22} />
        </IconButton>
        <h1>{settingSections[section].title}</h1>
      </div>
      <div className="settings-grid">
        <div className="settings-main">
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'connection' && (
            <section className="panel settings-section">
              <div className="settings-section-title">
                <Laptop size={20} />
                <div>
                  <h2>Подключение</h2>
                </div>
              </div>
              <button className="settings-link-row" onClick={() => setConnectOpen(true)}>
                <span className="settings-link-icon">
                  <Link2 size={20} />
                </span>
                <span>
                  <strong>{client?.connection.name ?? 'Добавить компьютер'}</strong>
                  <small>{client?.connection.url ?? 'QR-код, туннель или локальная сеть'}</small>
                </span>
                <ChevronRight size={18} />
              </button>
              {client?.connection.mode === 'bridge' && (
                <button className="settings-link-row" onClick={() => setDevices(true)}>
                  <span className="settings-link-icon">
                    <Smartphone size={20} />
                  </span>
                  <span>
                    <strong>Подключённые устройства</strong>
                    <small>Посмотреть и отозвать доступ</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              )}
            </section>
          )}
          {section === 'permissions' && (
            <section className="panel settings-section">
              <div className="settings-section-title">
                <ShieldCheck size={20} />
                <div>
                  <h2>Разрешения OpenCode</h2>
                  <p>Правила сохраняются в общих настройках OpenCode на компьютере.</p>
                </div>
              </div>
              <div className="permission-presets">
                <button disabled={!client} onClick={() => setPendingPermission(permissionPreset('ask'))}>
                  <ShieldCheck size={20} />
                  <strong>Под контролем</strong>
                  <span>Спрашивать перед действиями</span>
                </button>
                <button disabled={!client} onClick={() => setPendingPermission(permissionPreset('allow'))}>
                  <Check size={20} />
                  <strong>В потоке</strong>
                  <span>Правки — да, терминал — спросить</span>
                </button>
                <button disabled={!client} onClick={() => setPendingPermission('allow')}>
                  <Zap size={20} />
                  <strong>Автопилот</strong>
                  <span>Разрешать все действия</span>
                </button>
              </div>
              <div className="permission-rules">
                {tools.map(([id, label]) => {
                  const current =
                    permissionEdits[id] ?? (typeof permission === 'string' ? permission : permission?.[id]);
                  return (
                    <label className="permission-rule" key={id}>
                      <span>
                        {label}
                        <code>{id}</code>
                      </span>
                      <select
                        aria-label={label}
                        disabled={!client}
                        value={typeof current === 'string' ? current : current ? 'rules' : 'inherit'}
                        onChange={(event) =>
                          setPermissionEdits((old) => ({
                            ...old,
                            [id]: event.target.value as 'ask' | 'allow' | 'deny',
                          }))
                        }
                      >
                        {current && typeof current === 'object' && <option value="rules">По шаблонам</option>}
                        {!current && <option value="inherit">По умолчанию</option>}
                        <option value="ask">Спрашивать</option>
                        <option value="allow">Разрешать</option>
                        <option value="deny">Запрещать</option>
                      </select>
                    </label>
                  );
                })}
              </div>
              <div className="settings-section-actions">
                <button className="subtle-link" disabled={!client} onClick={() => setAdvanced(true)}>
                  Шаблоны и JSON
                  <ChevronRight size={15} />
                </button>
                <Button
                  variant="secondary"
                  disabled={!Object.keys(permissionEdits).length || !client}
                  onClick={() =>
                    setPendingPermission({
                      ...(typeof permission === 'string' ? { '*': permission } : permission),
                      ...permissionEdits,
                    })
                  }
                >
                  Сохранить правила
                </Button>
              </div>
            </section>
          )}
          {section === 'voice' && (
            <section className="panel settings-section">
              <div className="settings-section-title">
                <AudioLines size={20} />
                <div>
                  <h2>Голос → промпт</h2>
                  <p>Нативное распознавание речи устройства.</p>
                </div>
              </div>
              <Toggle
                checked={preferences.offlineSpeech}
                onChange={(offlineSpeech) => void perform(() => setPreferences({ offlineSpeech }))}
                label="Только на устройстве"
                description="Аудио не отправляется в облачный распознаватель. Нужен установленный языковой пакет."
              />
              <label className="permission-rule">
                <span>
                  Язык диктовки<code>speech locale</code>
                </span>
                <select
                  value={preferences.speechLocale}
                  onChange={(event) =>
                    void perform(() => setPreferences({ speechLocale: event.target.value }))
                  }
                >
                  <option value="ru-RU">Русский</option>
                  <option value="en-US">English (US)</option>
                  <option value="uk-UA">Українська</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="es-ES">Español</option>
                  <option value="fr-FR">Français</option>
                  <option value="zh-CN">中文</option>
                </select>
              </label>
              <p className="form-hint">
                Если офлайн-распознавание недоступно, OCC сообщит об этом. Облачный режим включается только
                этим переключателем.
              </p>
            </section>
          )}
        </div>
        <aside className="settings-aside">
          {section === 'updates' && <UpdateSettings />}
          {section === 'notifications' && <NotificationSettings />}
          {section === 'diagnostics' && <DiagnosticSettings />}
          {section === 'interface' && (
            <section className="panel settings-section">
              <div className="settings-section-title">
                <Smartphone size={20} />
                <div>
                  <h2>Интерфейс</h2>
                </div>
              </div>
              <Toggle
                checked={preferences.haptics}
                onChange={(haptics) => void perform(() => setPreferences({ haptics }))}
                label="Тактильный отклик"
                description="Короткий отклик на отправку и ответы"
              />
            </section>
          )}
        </aside>
      </div>
      {pendingPermission !== undefined && (
        <Modal
          title={pendingPermission === 'allow' ? 'Включить автопилот?' : 'Применить правила?'}
          onClose={() => setPendingPermission(undefined)}
        >
          <p className="modal-paragraph">
            {pendingPermission === 'allow'
              ? 'OpenCode сможет менять файлы, запускать команды и обращаться к внешним папкам без отдельных запросов разрешения. Настройка сохраняется в общей конфигурации на компьютере.'
              : 'Новые правила сохранятся в общей конфигурации OpenCode на компьютере. Настройки проекта, агента или сессии могут иметь приоритет.'}
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setPendingPermission(undefined)}>
              Отмена
            </Button>
            <Button
              onClick={() =>
                void perform(async () => {
                  await saveConfig({ permission: pendingPermission });
                  setPendingPermission(undefined);
                })
              }
            >
              Применить
              <Check size={16} />
            </Button>
          </div>
        </Modal>
      )}
      {advanced && <PermissionJson onClose={() => setAdvanced(false)} />}{' '}
      {devices && <DevicesModal onClose={() => setDevices(false)} />}
    </div>
  );
}

function PermissionJson({ onClose }: { onClose: () => void }) {
  const { config, saveConfig, perform } = usePocket();
  const [text, setText] = useState(
    JSON.stringify(config.permission ?? { bash: { '*': 'ask', 'git status*': 'allow' } }, null, 2),
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Правила по шаблонам"
      subtitle="OpenCode использует последнее совпавшее правило: общие шаблоны ставьте раньше частных."
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void perform(async () => {
            const permission = permissionSchema.parse(JSON.parse(text));
            await saveConfig({ permission });
            onClose();
          }).finally(() => setBusy(false));
        }}
      >
        <label>
          permission
          <textarea
            className="code-input"
            rows={14}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
          />
        </label>
        <Button type="submit" busy={busy}>
          Сохранить на компьютере
        </Button>
      </form>
    </Modal>
  );
}

function DevicesModal({ onClose }: { onClose: () => void }) {
  const { client, perform, forget } = usePocket();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (client) void perform(async () => setDevices(await client.companion<Device[]>('/devices')));
  }, [client, perform]);
  return (
    <Modal
      title="Устройства на связи"
      subtitle="У каждого устройства отдельный отзываемый ключ."
      onClose={onClose}
    >
      <div className="device-list">
        {devices.map((device) => (
          <div className="saved-connection" key={device.id}>
            <Smartphone size={21} />
            <div>
              <strong>
                {device.name}
                {device.current ? ' · это устройство' : ''}
              </strong>
              <small>{new Date(device.created).toLocaleDateString('ru')}</small>
            </div>
            <Button
              variant={selected === device.id ? 'danger' : 'ghost'}
              disabled={busy}
              onClick={() => {
                if (selected !== device.id) {
                  setSelected(device.id);
                  return;
                }
                setBusy(true);
                void perform(async () => {
                  await client!.companion(`/devices/${device.id}`, 'DELETE');
                  setDevices((old) => old.filter((item) => item.id !== device.id));
                  if (device.current) {
                    await forget(client!.connection.id);
                    onClose();
                  }
                }).finally(() => setBusy(false));
              }}
            >
              <Trash2 size={15} />
              {selected === device.id ? 'Отозвать?' : 'Отозвать'}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
