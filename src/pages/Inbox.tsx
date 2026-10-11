import { useState } from 'react';
import { ChevronRight, Inbox as InboxIcon, RefreshCw, Search } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { PermissionCard, QuestionCard } from '../components/Requests';
import { Button, EmptyState, IconButton } from '../components/ui';
import { folderName } from '../lib/format';
import { matchesSearch } from '../lib/session-search';
import type { PendingPermission, PendingQuestion } from '../types';

export function Inbox() {
  const { data, pendingCount, refresh, perform, refreshing, client, setScreen } = usePocket();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const visible = (request: PendingQuestion | PendingPermission) => {
    const question = 'questions' in request;
    if ((filter === 'questions' && !question) || (filter === 'permissions' && question)) return false;
    const session = data.sessions.find((item) => item.id === request.sessionID);
    return matchesSearch(
      `${session?.title ?? ''} ${session?.directory ?? request.directory ?? ''} ${JSON.stringify(question ? request.questions : [request.permission, request.patterns])}`,
      query,
    );
  };
  const questionCount = data.questions.filter(visible).length;
  const permissionCount = data.permissions.filter(visible).length;
  return (
    <div className="page inbox-page">
      <div className="page-heading">
        <div>
          <h1>
            Запросы<span className="heading-count">{pendingCount}</span>
          </h1>
        </div>
        <IconButton
          label="Обновить запросы"
          disabled={!client || refreshing}
          onClick={() => void perform(() => refresh())}
        >
          <RefreshCw size={21} />
        </IconButton>
      </div>
      {pendingCount > 0 && (
        <>
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Поиск запросов"
              placeholder="Сессия, проект или запрос"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button aria-label="Очистить поиск" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </label>
          <div className="segmented session-filters">
            {[
              ['all', 'Все'],
              ['questions', 'Вопросы'],
              ['permissions', 'Доступ'],
            ].map(([id, name]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                className={filter === id ? 'active' : ''}
                onClick={() => setFilter(id!)}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="inbox-content">
        {questionCount > 0 && <h2>Вопросы · {questionCount}</h2>}
        {data.questions.map((request) => (
          <div key={request.id} hidden={!visible(request)}>
            <RequestSession sessionID={request.sessionID} directory={request.directory} />
            <QuestionCard request={request} />
          </div>
        ))}
        {permissionCount > 0 && <h2>Доступ · {permissionCount}</h2>}
        {data.permissions.map((request) => (
          <div key={request.id} hidden={!visible(request)}>
            <RequestSession sessionID={request.sessionID} directory={request.directory} />
            <PermissionCard request={request} />
          </div>
        ))}
      </div>
      {pendingCount > 0 && !questionCount && !permissionCount && (
        <EmptyState
          icon={<Search size={28} />}
          title="Запросы не найдены"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Сбросить фильтры
            </Button>
          }
        >
          Измените текст поиска или тип запроса.
        </EmptyState>
      )}
      {!pendingCount && (
        <section className="panel">
          <EmptyState
            icon={<InboxIcon size={32} />}
            title="Нет запросов"
            action={
              <Button variant="secondary" onClick={() => setScreen('sessions')}>
                Вернуться к сессиям
                <ChevronRight size={16} />
              </Button>
            }
          >
            Сейчас нет открытых вопросов и запросов доступа.
          </EmptyState>
        </section>
      )}
    </div>
  );
}

function RequestSession({ sessionID, directory }: { sessionID: string; directory?: string }) {
  const { data, openSession, openRelatedSession, perform } = usePocket();
  const session = data.sessions.find((item) => item.id === sessionID);
  return (
    <button
      className="request-session"
      onClick={() =>
        session ? openSession(session) : void perform(() => openRelatedSession(sessionID, directory))
      }
    >
      <span className="mono">{session ? folderName(session.directory) : sessionID}</span>
      <span>{session?.title}</span>
      <ChevronRight size={14} />
    </button>
  );
}
