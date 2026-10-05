import { useState } from 'react';
import { ArrowRight, Check, ChevronRight, GitBranch, MessageSquare, Plus, Search, Terminal, Zap } from 'lucide-react';
import clsx from 'clsx';
import { usePocket } from '../store/PocketProvider';
import { folderName, timeAgo } from '../lib/format';
import { Button, EmptyState, Modal } from './ui';
import type { Session } from '../types';

export function SessionRow({ session }: { session: Session }) {
  const { data, openSession } = usePocket();
  const waiting = data.questions.some((item) => item.sessionID === session.id) || data.permissions.some((item) => item.sessionID === session.id);
  const status = data.statuses[session.id]?.type;
  const busy = status === 'busy' || status === 'retry';
  return <button className="session-row" onClick={() => openSession(session)}>
    <span className={clsx('session-icon', busy && 'session-icon-live', waiting && 'session-icon-wait')}>{waiting ? <MessageSquare size={20} /> : busy ? <Terminal size={21} /> : <GitBranch size={20} />}</span>
    <span className="session-main"><span className="session-title">{session.title || 'Без названия'}</span><span className="session-subtitle"><span className="mono">{folderName(session.directory)}</span>{session.parentID && <span>подзадача</span>}<span className="session-time-mobile">{timeAgo(session.time.updated)}</span></span></span>
    {session.summary && <span className="diff-summary"><span>+{session.summary.additions}</span><span>−{session.summary.deletions}</span></span>}
    <span className={clsx('status-pill', waiting ? 'status-wait' : busy ? 'status-live' : 'status-idle')}>{waiting ? <MessageSquare size={11} /> : busy ? <span className="live-dot" /> : <Check size={12}/>}<span>{waiting ? 'Ждёт ответа' : status === 'retry' ? 'Повтор' : busy ? 'Работает' : 'Готово'}</span></span>
    <span className="session-time mono">{timeAgo(session.time.updated)}</span><ChevronRight className="session-chevron" size={16} />
  </button>;
}

export function NewSession({ onClose }: { onClose: () => void }) {
  const { projects, client, createSession, perform } = usePocket();
  const [title, setTitle] = useState('');
  const [directory, setDirectory] = useState(client?.connection.directory ?? projects.find((item) => item.worktree !== '/')?.worktree ?? '');
  const [busy, setBusy] = useState(false);
  return <Modal title="Новая сессия" subtitle="Продолжение появится и на компьютере." onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => { event.preventDefault(); setBusy(true); void perform(async () => { await createSession(title, directory || undefined); onClose(); }).finally(() => setBusy(false)); }}>
      <label>Название<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Что сегодня соберём?" maxLength={200} /></label>
      <label>Папка проекта на компьютере<input list="project-folders" value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="C:\coding\project или /home/user/project" /><datalist id="project-folders">{projects.map((project) => <option key={project.id} value={project.worktree} />)}</datalist></label>
      <p className="form-hint">Укажите существующую папку. Работа и инструменты выполняются на подключённом компьютере.</p>
      <Button busy={busy} type="submit">Начать сессию<ArrowRight size={17}/></Button>
    </form>
  </Modal>;
}

export function SessionsPage() {
  const { data, client, setConnectOpen, refresh, perform, refreshing } = usePocket();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const waiting = new Set([...data.questions, ...data.permissions].map((item) => item.sessionID));
  const sessions = data.sessions.filter((item) => !item.time.archived)
    .filter((item) => `${item.title} ${item.directory}`.toLowerCase().includes(search.toLowerCase()))
    .filter((item) => filter === 'all' || (filter === 'busy' ? data.statuses[item.id]?.type === 'busy' : waiting.has(item.id)))
    .sort((a, b) => b.time.updated - a.time.updated);
  return <div className="page sessions-page"><div className="page-heading"><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h1>Твои сессии<span className="heading-count">{data.sessions.length}</span></h1><p>Тот же контекст. С любого экрана.</p></div><Button onClick={() => client ? setNewOpen(true) : setConnectOpen(true)}><Plus size={17}/>Новая сессия</Button></div>
    <div className="session-toolbar"><div className="segmented">{[['all','Все сессии'],['busy','В работе'],['waiting','Ждут ответа']].map(([value,label]) => <button key={value} className={clsx(filter === value && 'active')} onClick={() => setFilter(value!)}>{label}</button>)}</div><label className="search-field"><Search size={17}/><input aria-label="Поиск сессий" placeholder="Найти сессию…" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
    <section className="panel"><div className="panel-title"><span className="eyebrow">СЕССИИ / {String(sessions.length).padStart(2, '0')}</span><Button variant="ghost" busy={refreshing} disabled={!client} onClick={() => void perform(() => refresh())}>Обновить</Button></div>
      {sessions.length ? sessions.map((session) => <SessionRow key={session.id} session={session}/>) : <EmptyState icon={<Terminal size={30}/>} title={search ? 'Ничего не найдено' : 'Здесь начинается работа'} action={!client && <Button onClick={() => setConnectOpen(true)}>Подключить компьютер<ArrowRight size={17}/></Button>}>{search ? 'Попробуйте другое название или папку.' : client ? 'Создайте сессию или откройте её в OpenCode на компьютере.' : 'Подключите OpenCode, и ваши актуальные сессии появятся здесь.'}</EmptyState>}
    </section><div className="footnote"><Zap size={13}/><span>Сессии синхронизируются в реальном времени</span></div>{newOpen && <NewSession onClose={() => setNewOpen(false)}/>}</div>;
}
