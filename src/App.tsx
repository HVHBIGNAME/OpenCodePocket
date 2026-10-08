import { Component, Suspense, lazy, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Keyboard } from '@capacitor/keyboard';
import { ChevronDown, Cpu, LoaderCircle, MessageSquare, Settings2, Terminal, X } from 'lucide-react';
import { usePocket } from './store/PocketProvider';
import { Logo } from './components/Brand';
import { ConnectModal } from './components/ConnectModal';
import { Button, IconButton } from './components/ui';
import { Welcome } from './pages/Welcome';
import { SessionsPage } from './components/SessionList';
import { captureDiagnostic } from './lib/diagnostics';
import { isNative } from './lib/native';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Models = lazy(() => import('./pages/Models').then((module) => ({ default: module.Models })));
const Inbox = lazy(() => import('./pages/Inbox').then((module) => ({ default: module.Inbox })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));

const navigation = [
  { id: 'sessions', name: 'Сессии', icon: Terminal },
  { id: 'inbox', name: 'Запросы', icon: MessageSquare },
  { id: 'models', name: 'Модели', icon: Cpu },
  { id: 'settings', name: 'Настройки', icon: Settings2 },
] as const;

export function App() {
  const {
    ready,
    screen,
    setScreen,
    client,
    status,
    pendingCount,
    setConnectOpen,
    connectOpen,
    toast,
    setToast,
  } = usePocket();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, client?.connection.id]);
  useEffect(() => {
    if (!isNative) return;
    const handles = [
      Keyboard.addListener('keyboardWillShow', () => document.body.classList.add('keyboard-open')),
      Keyboard.addListener('keyboardWillHide', () => document.body.classList.remove('keyboard-open')),
    ];
    return () => {
      for (const handle of handles) void handle.then((value) => value.remove());
    };
  }, []);
  if (!ready)
    return (
      <div className="splash">
        <Logo size={52} />
        <strong>
          opencode pocket<span>.</span>
        </strong>
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  const chatting = screen === 'chat';
  const home = screen === 'sessions' || screen === 'overview';
  return (
    <div className={`app-shell ${chatting ? 'app-chat' : ''}`}>
      {!chatting && (
        <header className="app-header">
          <button className="wordmark" aria-label="Открыть сессии" onClick={() => setScreen('sessions')}>
            <Logo size={29} />
            <span>
              pocket<span className="accent">.</span>
            </span>
          </button>
          <button
            className="connection-switch"
            aria-label={`Подключение: ${client?.connection.name ?? 'добавить компьютер'}`}
            onClick={() => setConnectOpen(true)}
          >
            <span className={status === 'live' ? 'live-dot' : 'neutral-dot'} />
            <span>{client?.connection.name ?? 'Подключить ПК'}</span>
            <ChevronDown size={15} />
          </button>
        </header>
      )}
      <main className={chatting ? 'main-chat' : 'main-content'} id="main">
        <Suspense
          fallback={
            <div className="loading-state">
              <LoaderCircle size={24} className="spin" />
              Загружаем…
            </div>
          }
        >
          {home ? (
            client ? (
              <SessionsPage />
            ) : (
              <Welcome />
            )
          ) : screen === 'chat' ? (
            <Chat />
          ) : screen === 'models' ? (
            <Models />
          ) : screen === 'inbox' ? (
            <Inbox />
          ) : (
            <Settings />
          )}
        </Suspense>
      </main>
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
          <span>{toast.text}</span>
          <IconButton label="Скрыть сообщение" onClick={() => setToast(undefined)}>
            <X size={18} />
          </IconButton>
        </div>
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
        <Logo size={44} />
        <h1>Попробуем ещё раз?</h1>
        <p>Не удалось открыть экран. Отчёт о сбое сохранён, если диагностика включена.</p>
        <Button onClick={() => window.location.reload()}>Перезапустить OCC</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
