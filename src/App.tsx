import { Component, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Cpu,
  Inbox as InboxIcon,
  Laptop,
  LoaderCircle,
  MessageSquare,
  Settings2,
  X,
} from 'lucide-react';
import { PocketSnapshot, usePocket } from './store/PocketProvider';
import { PageDeck, PageScroll } from './components/PageDeck';
import type { Screen as ScreenName } from './types';
import { ConnectModal } from './components/ConnectModal';
import { Button, IconButton, Modal } from './components/ui';
import { Welcome } from './pages/Welcome';
import { SessionsPage } from './components/SessionList';
import { captureDiagnostic } from './lib/diagnostics';
import { installKeyboardHandling } from './lib/keyboard';
import { installGlassHandling } from './lib/glass';
import { installFocusHandling } from './lib/focus';
import { installUpdateChecking } from './lib/updates';
import { UpdateNotice, UpdateSettings } from './components/UpdateSettings';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Models = lazy(() => import('./pages/Models').then((module) => ({ default: module.Models })));
const Inbox = lazy(() => import('./pages/Inbox').then((module) => ({ default: module.Inbox })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));

const navigation = [
  { id: 'sessions', name: 'Сессии', icon: MessageSquare },
  { id: 'inbox', name: 'Запросы', icon: InboxIcon },
  { id: 'models', name: 'Модели', icon: Cpu },
  { id: 'settings', name: 'Настройки', icon: Settings2 },
] as const;

export function App() {
  const pocket = usePocket();
  useEffect(installFocusHandling, []);
  useEffect(installKeyboardHandling, []);
  useEffect(installGlassHandling, []);
  useEffect(installUpdateChecking, []);
  if (!pocket.ready)
    return (
      <div className="splash">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  const pageKey =
    pocket.screen === 'chat'
      ? `chat:${pocket.sessionID ?? ''}`
      : pocket.screen === 'overview'
        ? 'sessions'
        : pocket.screen;
  return (
    <div className="app-shell" data-connection-state={pocket.status}>
      <PageDeck
        key={pocket.client?.connection.id ?? 'welcome'}
        name="app"
        pageKey={pageKey}
        order={navigation.map((item) => item.id)}
        onBack={(key) => {
          pocket.haptic();
          if (!key.startsWith('chat:')) {
            pocket.setScreen(key as ScreenName);
            return;
          }
          const session = pocket.data.sessions.find((item) => item.id === key.slice(5));
          if (session) pocket.openSession(session);
          else pocket.setScreen('sessions');
        }}
      >
        <PocketSnapshot value={pocket}>
          <Screen />
        </PocketSnapshot>
      </PageDeck>
    </div>
  );
}

function Screen() {
  const scroll = useRef<HTMLElement>(null);
  const [errorDetails, setErrorDetails] = useState<string>();
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const { screen, setScreen, client, status, pendingCount, setConnectOpen, connectOpen, toast, setToast } =
    usePocket();
  const chatting = screen === 'chat';
  const home = screen === 'sessions' || screen === 'overview';
  return (
    <div className={`screen-layout ${chatting ? 'app-chat' : ''}`}>
      {!chatting && (
        <header className="app-header">
          <span className="app-wordmark">
            OpenCode <span>Pocket</span>
          </span>
          <button
            className="connection-switch"
            data-pocket-glass="connection"
            aria-label={`Подключение: ${client?.connection.name ?? 'добавить компьютер'}`}
            aria-describedby="connection-status"
            onClick={() => setConnectOpen(true)}
          >
            <Laptop size={16} aria-hidden />
            <span>{client?.connection.name ?? 'Подключить ПК'}</span>
            {client && <span className={status === 'live' ? 'live-dot' : 'neutral-dot'} />}
            <ChevronDown size={15} />
          </button>
          <span className="sr-only" id="connection-status">
            {!client
              ? 'Компьютер не подключён'
              : status === 'live'
                ? 'Соединение установлено'
                : status === 'offline'
                  ? 'Нет связи'
                  : 'Подключаемся'}
          </span>
        </header>
      )}
      <PageScroll.Provider value={scroll}>
        <main
          className={chatting ? 'main-chat' : 'main-content'}
          ref={scroll}
          data-page-scroll={!chatting || undefined}
        >
          {home ? (
            client ? (
              <SessionsPage key={client.connection.id} />
            ) : (
              <Welcome />
            )
          ) : screen === 'chat' ? (
            <Chat key={client?.connection.id} />
          ) : screen === 'models' ? (
            <Models />
          ) : screen === 'inbox' ? (
            <Inbox key={client?.connection.id} />
          ) : (
            <Settings />
          )}
        </main>
      </PageScroll.Provider>
      {!chatting && <UpdateNotice onOpen={() => setUpdatesOpen(true)} />}
      {updatesOpen && (
        <Modal title="Обновление Pocket" onClose={() => setUpdatesOpen(false)}>
          <UpdateSettings />
        </Modal>
      )}
      {!chatting && (
        <nav className="mobile-nav" aria-label="Главная навигация">
          {navigation.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              aria-label={name}
              aria-current={(home ? 'sessions' : screen) === id ? 'page' : undefined}
              className={(home ? 'sessions' : screen) === id ? 'active' : ''}
              onClick={() => setScreen(id)}
            >
              <span>
                <Icon size={23} />
                {id === 'inbox' && pendingCount > 0 && <i>{pendingCount > 9 ? '9+' : pendingCount}</i>}
              </span>
              <small>{name}</small>
            </button>
          ))}
        </nav>
      )}
      {connectOpen && <ConnectModal />}
      {toast && (
        <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          <span className="toast-summary">{toast.text}</span>
          {toast.error && (
            <button
              className="toast-details"
              onClick={() => {
                setErrorDetails(toast.text);
                setToast(undefined);
              }}
            >
              Подробнее
            </button>
          )}
          <IconButton label="Скрыть сообщение" onClick={() => setToast(undefined)}>
            <X size={18} />
          </IconButton>
        </div>
      )}
      {errorDetails && (
        <Modal title="Ошибка" onClose={() => setErrorDetails(undefined)}>
          <pre className="error-details">{errorDetails}</pre>
        </Modal>
      )}
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    captureDiagnostic(error, { kind: 'startup', operation: 'startup', fatal: true });
  }
  render() {
    return this.state.error ? (
      <div className="splash error-splash">
        <h1>Ошибка приложения</h1>
        <p>Не удалось открыть экран. Отчёт о сбое сохранён, если диагностика включена.</p>
        <Button onClick={() => window.location.reload()}>Перезапустить OCC</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
