import { Component, Suspense, lazy, useLayoutEffect, type ReactNode } from 'react';
import { ArrowUpRight, Bell, ChevronDown, CircleHelp, Cpu, GitBranch as Github, LayoutDashboard, LoaderCircle, MessageSquare, Plus, Settings2, Terminal, X } from 'lucide-react';
import { usePocket } from './store/PocketProvider';
import { Logo } from './components/Brand';
import { ConnectModal } from './components/ConnectModal';
import { Button, IconButton } from './components/ui';
import { Overview } from './pages/Overview';
import { SessionsPage } from './components/SessionList';
import type { Screen } from './types';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Models = lazy(() => import('./pages/Models').then((module) => ({ default: module.Models })));
const Inbox = lazy(() => import('./pages/Inbox').then((module) => ({ default: module.Inbox })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));

const navigation = [
  { id: 'overview', name: 'Обзор', icon: LayoutDashboard }, { id: 'sessions', name: 'Сессии', icon: Terminal },
  { id: 'inbox', name: 'Входящие', icon: MessageSquare }, { id: 'models', name: 'Модели', icon: Cpu },
  { id: 'settings', name: 'Настройки', icon: Settings2 },
] as const;

export function App() {
  const { ready, screen, setScreen, client, status, pendingCount, data, setConnectOpen, connectOpen, toast, setToast } = usePocket();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [screen, client?.connection.id]);
  if (!ready) return <div className="splash"><Logo size={58}/><span className="eyebrow">OPEN CODE POCKET</span><LoaderCircle size={20} className="spin"/></div>;
  const activeScreen = screen === 'chat' ? 'sessions' : screen;
  const go = (next: Screen) => setScreen(next);
  return <div className="app-shell"><aside className="sidebar"><button className="wordmark" onClick={() => go('overview')} aria-label="OCC — на главную"><Logo size={37}/><span>opencode<span className="wordmark-pocket">pocket<span className="wordmark-dot">.</span></span></span><span className="wordmark-beta mono">OCC</span></button>
      <button className="workspace-switch" onClick={() => setConnectOpen(true)}><span className="workspace-avatar">{client?.connection.name.charAt(0).toUpperCase() ?? 'H'}</span><span><strong>{client?.connection.name ?? 'Моя лаборатория'}</strong><small>{client ? 'Личное пространство' : 'Подключи OpenCode'}</small></span><ChevronDown size={14}/></button>
      <span className="nav-label eyebrow">WORKSPACE</span><nav className="desktop-nav">{navigation.map(({ id, name, icon: Icon }) => <button key={id} className={activeScreen === id ? 'active' : ''} onClick={() => go(id)}><Icon size={19}/><span>{name}</span>{id === 'inbox' && pendingCount > 0 ? <span className="nav-count">{pendingCount}</span> : id === 'sessions' && data.sessions.length > 0 ? <span className="nav-number mono">{data.sessions.length}</span> : null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="eyebrow">FROM DESK TO ANYWHERE</span><p>Меньше границ.<br/><strong>Больше коммитов.</strong></p><span className="sidebar-note-lines"/><ArrowUpRight size={20}/></div><a className="sidebar-link" href="https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/connect.md" target="_blank" rel="noreferrer"><CircleHelp size={17}/><span>Как это работает</span><ArrowUpRight size={14}/></a><a className="sidebar-link" href="https://github.com/HVHBIGNAME/OpenCodePocket" target="_blank" rel="noreferrer"><Github size={17}/><span>GitHub</span><ArrowUpRight size={14}/></a><div className="author-stamp"><span className="author-avatar">HV</span><span><strong>HVHBIGNAME</strong><small>Vibe in. Systems out.</small></span><span className="author-online"/></div></div>
    </aside><div className="main-shell"><header className="topbar"><div className="topbar-path"><span className="mobile-logo"><Logo size={24}/></span><span className="mono">WORKSPACE</span><span className="path-divider">/</span><strong>{navigation.find((item) => item.id === activeScreen)?.name}</strong></div><div className="topbar-actions"><button className={`connection-indicator ${status === 'live' ? 'connected' : ''}`} onClick={() => setConnectOpen(true)}><span className={status === 'live' ? 'live-dot' : 'neutral-dot'}/><span>{status === 'live' ? 'Соединение активно' : status === 'connecting' ? 'Подключаемся' : status === 'reconnecting' ? 'Переподключение' : 'Не подключено'}</span></button><span className="topbar-divider"/><IconButton label="Входящие и уведомления" onClick={() => go('inbox')}><Bell size={19}/>{pendingCount > 0 && <span className="notification-dot"/>}</IconButton><IconButton label="Добавить подключение" onClick={() => setConnectOpen(true)}><Plus size={19}/></IconButton></div></header>
      <main className={`main-content ${screen === 'chat' ? 'main-chat' : ''}`} id="main"><Suspense fallback={<div className="loading-state"><LoaderCircle size={24} className="spin"/>Один момент…</div>}>{screen === 'overview' ? <Overview/> : screen === 'sessions' ? <SessionsPage/> : screen === 'chat' ? <Chat/> : screen === 'models' ? <Models/> : screen === 'inbox' ? <Inbox/> : <Settings/>}</Suspense></main>
    </div><nav className="mobile-nav" aria-label="Главная навигация">{navigation.filter((item) => item.id !== 'models').map(({ id, name, icon: Icon }) => <button key={id} className={activeScreen === id || (id === 'settings' && activeScreen === 'models') ? 'active' : ''} onClick={() => go(id)}><span><Icon size={21}/>{id === 'inbox' && pendingCount > 0 && <i>{pendingCount}</i>}</span><small>{name}</small></button>)}</nav>
    {connectOpen && <ConnectModal/>}{toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span><IconButton label="Скрыть сообщение" onClick={() => setToast(undefined)}><X size={17}/></IconButton></div>}
  </div>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <div className="splash error-splash"><Logo size={42}/><h1>Не получилось открыть экран</h1><p>{this.state.error.message}</p><Button onClick={() => window.location.reload()}>Перезапустить OCC</Button></div> : this.props.children;
  }
}
