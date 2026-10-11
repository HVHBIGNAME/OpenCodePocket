import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Folder,
  GitBranch,
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
import {
  defaultSessionFilters,
  filterSessions,
  groupSessions,
  matchesSearch,
  stableSessionOrder,
} from '../lib/session-search';

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
            {session.time.archived
              ? 'В архиве'
              : waiting
                ? 'Ждёт тебя'
                : status === 'retry'
                  ? 'Повтор запроса'
                  : busy
                    ? 'Работает'
                    : 'Готово'}
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
  const [search, setSearch] = useState('');
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
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Поиск проектов"
              placeholder="Найти папку проекта"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        )}
        {!other && (
          <div className="project-picker">
            {folders
              .filter((folder) => matchesSearch(folder, search))
              .map((folder) => (
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
            {!folders.some((folder) => matchesSearch(folder, search)) && (
              <p className="form-hint">Проект не найден. Можно указать папку вручную.</p>
            )}
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
  const { data, refresh, perform, refreshing, status, sessionFilters, setSessionFilters, sessionListView } =
    usePocket();
  const { search, filter, project, children } = sessionFilters;
  const [visibleCount, setVisibleCount] = useState(sessionListView.current.visible);
  const [newOpen, setNewOpen] = useState(false);
  const [pull, setPull] = useState(0);
  const pullStart = useRef<number | undefined>(undefined);
  const { sessions: allSessions, statuses, questions, permissions } = data;
  const matches = useMemo(
    () => filterSessions({ sessions: allSessions, statuses, questions, permissions }, sessionFilters),
    [allSessions, statuses, questions, permissions, sessionFilters],
  );
  const ordered = useMemo(
    () => stableSessionOrder(allSessions, sessionListView.current.order),
    [allSessions, sessionListView],
  );
  const matchingIDs = new Set(matches.map((item) => item.id));
  const sessions = ordered.filter((item) => matchingIDs.has(item.id));
  useLayoutEffect(() => {
    sessionListView.current.order = ordered.map((item) => item.id);
  }, [ordered, sessionListView]);
  useLayoutEffect(() => {
    window.scrollTo(0, sessionListView.current.scroll);
    const save = () => {
      sessionListView.current.scroll = window.scrollY;
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [sessionListView]);
  useLayoutEffect(() => {
    sessionListView.current.visible = visibleCount;
  }, [visibleCount, sessionListView]);
  const groups = groupSessions(sessions.slice(0, visibleCount));
  const folders = useMemo(
    () => [...new Set(data.sessions.map((item) => item.directory))].sort(),
    [data.sessions],
  );
  const updateFilters = (patch: Partial<typeof sessionFilters>) => {
    setSessionFilters((previous) => ({ ...previous, ...patch }));
    setVisibleCount(60);
  };
  return (
    <div
      className="page sessions-page"
      onTouchStart={(event) => {
        const control =
          event.target instanceof Element && event.target.closest('input, button, select, label');
        pullStart.current =
          !control && !refreshing && window.scrollY <= 0 ? event.touches[0]?.clientY : undefined;
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
      onTouchCancel={() => {
        setPull(0);
        pullStart.current = undefined;
      }}
    >
      <div className="page-heading">
        <div>
          <h1>
            Сессии<span className="heading-count">{sessions.length}</span>
          </h1>
          {status !== 'live' && <p>Восстановление соединения…</p>}
        </div>
        <IconButton
          label="Обновить сессии"
          disabled={refreshing}
          onClick={() => void perform(() => refresh())}
        >
          <RefreshCw size={21} />
        </IconButton>
      </div>
      {pull > 25 && (
        <div className="pull-refresh">
          {pull > 65 ? 'Отпустите для обновления' : 'Потяните для обновления'}
        </div>
      )}
      <label className="search-field">
        <Search size={19} />
        <input
          aria-label="Поиск сессий"
          placeholder="Найти сессию или проект"
          value={search}
          onChange={(event) => updateFilters({ search: event.target.value })}
        />
        {search && (
          <button aria-label="Очистить поиск" onClick={() => updateFilters({ search: '' })}>
            ×
          </button>
        )}
      </label>
      <div className="segmented session-filters">
        {(
          [
            ['all', 'Все'],
            ['busy', 'В работе'],
            ['waiting', 'Ждут ответа'],
            ['archived', 'Архив'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            className={filter === value ? 'active' : ''}
            onClick={() => updateFilters({ filter: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="session-scope">
        <select
          aria-label="Фильтр по проекту"
          value={project}
          onChange={(event) => updateFilters({ project: event.target.value })}
        >
          <option value="">Все проекты</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
        <label className="subtask-filter">
          <input
            type="checkbox"
            checked={children}
            onChange={(event) => updateFilters({ children: event.target.checked })}
          />
          С подзадачами
        </label>
      </div>
      <section className="session-feed" aria-label="Список сессий">
        {sessions.length ? (
          groups.map(([directory, items]) => (
            <section className="session-group" key={directory} aria-label={`Проект ${directory}`}>
              <h2 title={directory}>
                <Folder size={16} />
                {folderName(directory)}
                <small>{items.length}</small>
              </h2>
              {items.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))}
            </section>
          ))
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
              !search && !project && filter === 'all' ? (
                <Button onClick={() => setNewOpen(true)}>
                  Создать сессию
                  <Plus size={19} />
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => updateFilters(defaultSessionFilters)}>
                  Сбросить фильтры
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
      {sessions.length > visibleCount && (
        <Button
          variant="secondary"
          className="more-sessions"
          onClick={() => setVisibleCount((count) => count + 60)}
        >
          Показать ещё · {sessions.length - visibleCount}
        </Button>
      )}
      <button className="new-session-fab" aria-label="Новая сессия" onClick={() => setNewOpen(true)}>
        <Plus size={22} />
        <span>Новая</span>
      </button>
      {newOpen && <NewSession onClose={() => setNewOpen(false)} />}
    </div>
  );
}
