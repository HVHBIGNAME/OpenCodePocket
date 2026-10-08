import { Component, Suspense, lazy, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Cpu, LoaderCircle, MessageSquare, Settings2, Terminal, X } from 'lucide-react';
import { usePocket } from './store/PocketProvider';
import { ConnectModal } from './components/ConnectModal';
import { Button, IconButton, Modal } from './components/ui';
import { Welcome } from './pages/Welcome';
import { SessionsPage } from './components/SessionList';
import { captureDiagnostic } from './lib/diagnostics';
import { installKeyboardHandling } from './lib/keyboard';

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
  const [errorDetails, setErrorDetails] = useState<string>();
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
  useEffect(installKeyboardHandling, []);
  if (!ready)
    return (
      <div className="splash">
        <LoaderCircle size={22} className="spin" />
      </div>
    );
  const chatting = screen === 'chat';
  const home = screen === 'sessions' || screen === 'overview';
  return (
    <div className={`app-shell ${chatting ? 'app-chat' : ''}`}>
      {!chatting && (
        <header className="app-header">
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
