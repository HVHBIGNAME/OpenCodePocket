import { useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Folder,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Terminal,
} from 'lucide-react';
import clsx from 'clsx';
import { usePocket } from '../store/PocketProvider';
import { folderName, timeAgo } from '../lib/format';
import { Button, EmptyState, IconButton, Modal } from './ui';
import type { Session } from '../types';

export function SessionRow({ session }: { session: Session }) {
  const { data, openSession } = usePocket();
  const waiting =
    data.questions.some((item) => item.sessionID === session.id) ||
    data.permissions.some((item) => item.sessionID === session.id);
  const status = data.statuses[session.id]?.type;
  const busy = status === 'busy' || status === 'retry';
  return (
    <button
      className={`session-row ${waiting ? 'session-awaiting' : ''}`}
      onClick={() => openSession(session)}
    >
      <span className={clsx('session-icon', busy && 'session-icon-live', waiting && 'session-icon-wait')}>
        {waiting ? <MessageSquare size={20} /> : busy ? <Terminal size={20} /> : <GitBranch size={20} />}
      </span>
      <span className="session-main">
        <span className="session-title">{session.title || 'Новая сессия'}</span>
        <span className="session-subtitle">
          <span>{folderName(session.directory)}</span>
          <span>·</span>
          <span>{timeAgo(session.time.updated)}</span>
        </span>
        <span className="session-meta">
          <span className={`status-pill ${waiting ? 'status-wait' : busy ? 'status-live' : 'status-idle'}`}>
            {waiting ? (
              <MessageSquare size={12} />
            ) : busy ? (
              <span className="live-dot" />
            ) : (
              <Check size={12} />
            )}{' '}
            {waiting ? 'Ждёт тебя' : status === 'retry' ? 'Повтор запроса' : busy ? 'Работает' : 'Готово'}
          </span>
          {session.summary && (
            <span className="diff-summary">
              <span>+{session.summary.additions}</span>
              <span>−{session.summary.deletions}</span>
            </span>
          )}
          {session.parentID && <span className="subtask-tag">Подзадача</span>}
        </span>
      </span>
      <ChevronRight size={18} className="session-chevron" />
    </button>
  );
}

export function NewSession({ onClose }: { onClose: () => void }) {
  const { projects, client, data, createSession, perform } = usePocket();
  const folders = [
    ...new Set(
      [
        client?.connection.directory,
        ...data.sessions.map((item) => item.directory),
        ...projects.map((item) => item.worktree),
      ].filter((value): value is string => Boolean(value) && value !== '/'),
    ),
  ];
  const [title, setTitle] = useState('');
  const [directory, setDirectory] = useState(folders[0] ?? '');
  const [other, setOther] = useState(!folders.length);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Новая сессия" subtitle="Выбери проект, с которым будем работать." onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void perform(async () => {
            await createSession(title, directory || undefined);
            onClose();
          }).finally(() => setBusy(false));
        }}
      >
        {!other && (
          <div className="project-picker">
            {folders.slice(0, 5).map((folder) => (
              <button
                type="button"
                className={`option-row ${folder === directory ? 'selected' : ''}`}
                key={folder}
                onClick={() => setDirectory(folder)}
              >
                <Folder size={21} />
                <span>
                  <strong>{folderName(folder)}</strong>
                  <small>{folder}</small>
                </span>
                {folder === directory && <Check size={20} />}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="text-action" onClick={() => setOther(!other)}>
          {other && folders.length ? 'Выбрать недавний проект' : 'Указать другую папку'}
        </button>
        {other && (
          <label>
            Папка на компьютере
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="C:\coding\project или /home/user/project"
              spellCheck={false}
            />
          </label>
        )}
        <label>
          Название <span className="optional">необязательно</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например, новый экран настроек"
            maxLength={200}
          />
        </label>
        <Button busy={busy} type="submit">
          Создать сессию
          <ArrowRight size={18} />
        </Button>
      </form>
    </Modal>
  );
}

export function SessionsPage() {
  const { data, refresh, perform, refreshing, status } = usePocket();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | undefined>(undefined);
  const waiting = new Set([...data.questions, ...data.permissions].map((item) => item.sessionID));
  const sessions = data.sessions
    .filter((item) => !item.time.archived)
    .filter((item) => `${item.title} ${item.directory}`.toLowerCase().includes(search.toLowerCase()))
    .filter(
      (item) =>
        filter === 'all' ||
        (filter === 'busy'
          ? ['busy', 'retry'].includes(data.statuses[item.id]?.type ?? '')
          : waiting.has(item.id)),
    )
    .sort((a, b) => b.time.updated - a.time.updated);
  return (
    <div
      className="page sessions-page"
      onTouchStart={(event) => {
        pullStart.current = window.scrollY <= 0 ? event.touches[0]?.clientY : undefined;
      }}
      onTouchMove={(event) => {
        if (pullStart.current !== undefined)
          setPull(Math.min(85, Math.max(0, (event.touches[0]?.clientY ?? 0) - pullStart.current)));
      }}
      onTouchEnd={() => {
        if (pull > 65) void perform(() => refresh());
        setPull(0);
        pullStart.current = undefined;
      }}
    >
      <div className="page-heading">
        <div>
          <h1>
            Сессии<span className="heading-count">{data.sessions.length}</span>
          </h1>
          {status !== 'live' && <p>Восстановление соединения…</p>}
        </div>
        <IconButton
          label="Обновить сессии"
          disabled={refreshing}
          onClick={() => void perform(() => refresh())}
        >
          <RefreshCw size={21} className={refreshing ? 'spin' : ''} />
        </IconButton>
      </div>
      {(pull > 25 || refreshing) && (
        <div className="pull-refresh">
          <LoaderCircle size={18} className="spin" />
          {refreshing ? 'Обновляем…' : pull > 65 ? 'Отпусти, чтобы обновить' : 'Потяни ещё немного'}
        </div>
      )}
      <label className="search-field">
        <Search size={19} />
        <input
          aria-label="Поиск сессий"
          placeholder="Найти сессию или проект"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button aria-label="Очистить поиск" onClick={() => setSearch('')}>
            ×
          </button>
        )}
      </label>
      <div className="segmented session-filters">
        {[
          ['all', 'Все'],
          ['busy', 'В работе'],
          ['waiting', 'Ждут ответа'],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="session-feed" aria-label="Список сессий">
        {sessions.length ? (
          sessions.map((session) => <SessionRow key={session.id} session={session} />)
        ) : (
          <EmptyState
            icon={<Terminal size={29} />}
            title={
              search
                ? 'Сессии не найдены'
                : filter !== 'all'
                  ? 'Нет сессий по выбранному фильтру'
                  : 'Нет сессий'
            }
            action={
              !search &&
              filter === 'all' && (
                <Button onClick={() => setNewOpen(true)}>
                  Создать сессию
                  <Plus size={19} />
                </Button>
              )
            }
          >
            {search
              ? 'Попробуй название проекта или другую часть заголовка.'
              : 'Сессии с компьютера появятся здесь автоматически.'}
          </EmptyState>
        )}
      </section>
      <button className="new-session-fab" aria-label="Новая сессия" onClick={() => setNewOpen(true)}>
        <Plus size={22} />
        <span>Новая</span>
      </button>
      {newOpen && <NewSession onClose={() => setNewOpen(false)} />}
    </div>
  );
}
