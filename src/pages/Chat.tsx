import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  Archive,
  ArchiveRestore,
  Brain,
  ChevronRight,
  CheckSquare,
  Code2,
  FileCode2,
  GitBranch,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Share2,
  Search,
  Split,
} from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { folderName } from '../lib/format';
import { Button, EmptyState, IconButton, Modal, CopyButton } from '../components/ui';
import { MessageView } from '../components/MessageView';
import { RequestSheet } from '../components/Requests';
import { Composer } from '../components/Composer';
import { SessionDetails } from '../components/SessionDetails';
import { ChatSearch } from '../components/ChatSearch';
import { AgentSessions } from '../components/AgentSessions';
import type { MessageEntry, Session } from '../types';
import { dragFeedback, useSwipe } from '../lib/gestures';

const emptyMessages: MessageEntry[] = [];
const chatTabs = ['chat', 'diff', 'todos', 'files'] as const;

export function Chat() {
  const {
    session,
    data,
    setScreen,
    messageLoading,
    loadMessages,
    historyLimits,
    chatPositions,
    perform,
    status,
    openRelatedSession,
    refresh,
    refreshing,
    setConnectOpen,
    haptic,
  } = usePocket();
  const [tab, setTab] = useState<'chat' | 'diff' | 'todos' | 'files'>('chat');
  const [actions, setActions] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMatch, setSearchMatch] = useState<string>();
  const [atBottom, setAtBottom] = useState(() =>
    session ? (chatPositions.current.get(session.id)?.bottom ?? true) : true,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedID = session?.id;
  const loadedEntries = selectedID ? (data.messages[selectedID] ?? emptyMessages) : emptyMessages;
  const revertID = session?.revert?.messageID;
  const entries = useMemo(
    () => (revertID ? loadedEntries.filter((entry) => entry.info.id < revertID) : loadedEntries),
    [loadedEntries, revertID],
  );
  const missingReasoning = entries.some((entry) =>
    entry.parts.some((part) => part.type === 'reasoning' && !part.text.trim() && part.time.end),
  );
  const limit = selectedID ? (historyLimits[selectedID] ?? 100) : 100;
  const prependAnchor = useRef<{ id: string; top: number; entries: MessageEntry[] } | undefined>(undefined);
  const previousSession = useRef<string | undefined>(undefined);
  const positions = chatPositions;
  const previousTab = useRef(tab);
  const pageRef = useRef<HTMLDivElement>(null);
  const backFromDetails = useRef<(() => void) | undefined>(undefined);
  const [detailBackLabel, setDetailBackLabel] = useState('');
  const onDetailBack = useCallback((handler?: () => void, label = '') => {
    backFromDetails.current = handler;
    setDetailBackLabel(label);
  }, []);
  const goBack = () => {
    if (backFromDetails.current) {
      backFromDetails.current();
      return;
    }
    if (tab !== 'chat') {
      setTab('chat');
      return;
    }
    if (session?.parentID) void perform(() => openRelatedSession(session.parentID!, session.directory));
    else setScreen('sessions');
  };
  const backAction = useRef(goBack);
  useLayoutEffect(() => {
    backAction.current = goBack;
  });
  useEffect(() => {
    const back = (event: Event) => {
      event.preventDefault();
      backAction.current();
    };
    document.addEventListener('pocket:navigate-back', back);
    return () => document.removeEventListener('pocket:navigate-back', back);
  }, []);
  const edgeSwipe = useRef(false);
  useSwipe(pageRef, {
    axis: 'x',
    resetKey: `${selectedID}:${tab}`,
    canStart: (target, x) => {
      if (
        document.querySelector('dialog[open]') ||
        target.closest(
          'pre, code, input, textarea, select, a, summary, [contenteditable="true"], .composer-wrap',
        )
      )
        return false;
      if (target.closest('button') && !target.closest('.chat-tabs')) return false;
      edgeSwipe.current = x - (pageRef.current?.getBoundingClientRect().left ?? 0) <= 28;
      return edgeSwipe.current || Boolean(target.closest('.chat-scroll, .details-scroll, .chat-tabs'));
    },
    onProgress: (distance) =>
      dragFeedback(
        pageRef.current,
        'x',
        edgeSwipe.current ? Math.max(0, Math.min(distance, 220)) : Math.max(-36, Math.min(distance, 36)),
      ),
    onSwipe: (direction) => {
      if (edgeSwipe.current && direction > 0) {
        haptic();
        goBack();
        return;
      }
      const next = chatTabs[chatTabs.indexOf(tab) - direction];
      if (next) {
        haptic();
        setTab(next);
      }
    },
  });
  const questions = data.questions.filter((item) => item.sessionID === session?.id);
  const permissions = data.permissions.filter((item) => item.sessionID === session?.id);
  const requestCount = questions.length + permissions.length;
  useEffect(() => {
    if (!requestCount) setRequestsOpen(false);
  }, [requestCount]);
  useLayoutEffect(() => {
    if (selectedID !== previousSession.current) {
      setTab('chat');
      setSearchOpen(false);
      setSearchMatch(undefined);
      prependAnchor.current = undefined;
      const saved = selectedID ? positions.current.get(selectedID) : undefined;
      setAtBottom(saved?.bottom ?? true);
      if (scrollRef.current)
        scrollRef.current.scrollTop = saved && !saved.bottom ? saved.top : scrollRef.current.scrollHeight;
      setRequestsOpen(false);
      setActions(false);
      previousSession.current = selectedID;
    } else if (tab === 'chat' && previousTab.current !== 'chat' && scrollRef.current) {
      const saved = selectedID ? positions.current.get(selectedID) : undefined;
      scrollRef.current.scrollTop = saved && !saved.bottom ? saved.top : scrollRef.current.scrollHeight;
    } else if (prependAnchor.current && prependAnchor.current.entries !== entries && scrollRef.current) {
      const anchor = prependAnchor.current;
      const element = scrollRef.current.querySelector(`[data-message-id="${CSS.escape(anchor.id)}"]`);
      if (element) scrollRef.current.scrollTop += element.getBoundingClientRect().top - anchor.top;
      prependAnchor.current = undefined;
    } else if (atBottom && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    previousTab.current = tab;
  }, [selectedID, entries, atBottom, tab, positions]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (atBottom) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [atBottom, tab, session?.id]);
  if (!session)
    return (
      <div className="page">
        <EmptyState
          icon={<MessageSquare size={30} />}
          title="Открой сессию"
          action={<Button onClick={() => setScreen('sessions')}>К сессиям</Button>}
        >
          Выбери разговор, чтобы продолжить работу.
        </EmptyState>
      </div>
    );
  const busy = data.statuses[session.id]?.type === 'busy' || data.statuses[session.id]?.type === 'retry';
  return (
    <div className="chat-page" ref={pageRef}>
      <header className="chat-heading">
        <IconButton
          label={
            detailBackLabel ||
            (tab !== 'chat'
              ? 'Назад к диалогу'
              : session.parentID
                ? 'Назад к основной сессии'
                : 'Назад к сессиям')
          }
          onClick={goBack}
        >
          <ArrowLeft size={20} />
        </IconButton>
        <div>
          <span className="eyebrow">
            <GitBranch size={13} />
            {folderName(session.directory)}
            {busy && (
              <span className="chat-busy">
                <span className="live-dot" />
                работает
              </span>
            )}
          </span>
          <h1>{session.title}</h1>
        </div>
        <IconButton
          label="Поиск по диалогу"
          onClick={() => {
            setTab('chat');
            setSearchOpen((open) => !open);
          }}
        >
          <Search size={19} />
        </IconButton>
        <IconButton label="Действия с сессией" onClick={() => setActions(true)}>
          <MoreHorizontal size={21} />
        </IconButton>
        {requestCount > 0 && (
          <IconButton
            label="Нужен твой ответ"
            className="request-compact"
            onClick={() => setRequestsOpen(true)}
          >
            <MessageSquare size={19} />
            <small>{requestCount}</small>
          </IconButton>
        )}
      </header>
      <div className="chat-navigation">
        <nav className="chat-tabs" aria-label="Содержимое сессии">
          {(
            [
              ['chat', MessageSquare, 'Диалог'],
              ['diff', Code2, 'Изменения'],
              ['todos', CheckSquare, 'Задачи'],
              ['files', FileCode2, 'Файлы'],
            ] as const
          ).map(([value, Icon, label]) => (
            <button
              key={value}
              aria-current={tab === value ? 'page' : undefined}
              className={tab === value ? 'active' : ''}
              onClick={() => setTab(value)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <AgentSessions key={session.id} parentID={session.id} />
      </div>
      {status !== 'live' && (
        <div className="offline-banner">
          <span>
            {status === 'offline' ? 'Нет доступа к серверу.' : 'Восстанавливаем связь.'} Черновик сохранён в
            приложении.
          </span>
          <Button
            variant="ghost"
            busy={refreshing}
            onClick={() => (status === 'offline' ? setConnectOpen(true) : void perform(() => refresh()))}
          >
            {status === 'offline' ? 'Подключиться' : 'Повторить'}
          </Button>
        </div>
      )}
      {tab === 'chat' ? (
        <>
          {searchOpen && (
            <ChatSearch
              key={`search.${session.id}`}
              entries={entries}
              onClose={() => {
                setSearchOpen(false);
                setSearchMatch(undefined);
              }}
              onSelect={(id) => {
                setAtBottom(false);
                setSearchMatch(id);
                const element = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
                if (element && scrollRef.current) {
                  for (const detail of element.querySelectorAll('details')) detail.open = true;
                  scrollRef.current.scrollTop +=
                    element.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 12;
                }
              }}
            />
          )}
          <div
            className="chat-scroll"
            ref={scrollRef}
            onScroll={() => {
              const element = scrollRef.current;
              if (element) {
                const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
                setAtBottom(bottom);
                positions.current.set(session.id, { top: element.scrollTop, bottom });
              }
            }}
          >
            <div className="messages-inner">
              {missingReasoning && (
                <details className="reasoning-availability">
                  <summary>
                    <Brain size={14} />О тексте рассуждений
                  </summary>
                  <p>
                    Сервер передал некоторые блоки рассуждений без текста. Доступный текст показывается в
                    сообщениях; пустые блоки скрыты.
                  </p>
                </details>
              )}
              {entries.length >= limit && (
                <div className="load-history">
                  <Button
                    variant="ghost"
                    busy={messageLoading}
                    onClick={() => {
                      const scroller = scrollRef.current;
                      const anchor =
                        scroller &&
                        [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')].find(
                          (item) =>
                            item.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top,
                        );
                      if (anchor?.dataset.messageId)
                        prependAnchor.current = {
                          id: anchor.dataset.messageId,
                          top: anchor.getBoundingClientRect().top,
                          entries,
                        };
                      setAtBottom(false);
                      void perform(() => loadMessages(session, limit + 100)).then((success) => {
                        if (!success) prependAnchor.current = undefined;
                      });
                    }}
                  >
                    Загрузить более ранние сообщения
                  </Button>
                </div>
              )}
              {!entries.length &&
                (messageLoading ? (
                  <div className="loading-state">
                    <LoaderCircle size={22} className="spin" />
                    Загружаем контекст…
                  </div>
                ) : (
                  <EmptyState icon={<Code2 size={28} />} title="Нет сообщений">
                    Введите запрос.
                  </EmptyState>
                ))}
              {entries.map((entry) => (
                <MessageView key={entry.info.id} entry={entry} highlighted={entry.info.id === searchMatch} />
              ))}
              {busy && (
                <div className="thinking-indicator">
                  <span className="mono">OpenCode работает</span>
                </div>
              )}
            </div>
          </div>
          {!atBottom && (
            <button className="jump-bottom" onClick={() => setAtBottom(true)}>
              <ArrowDown size={17} />К последнему
            </button>
          )}
          {requestCount > 0 && (
            <button className="request-tray" onClick={() => setRequestsOpen(true)}>
              <MessageSquare size={19} />
              <span>Нужен твой ответ</span>
              <strong>{requestCount}</strong>
              <ChevronRight size={18} />
            </button>
          )}
          {session.time.archived ? (
            <div className="archived-notice">
              Сессия в архиве. Восстановите её через меню действий, чтобы продолжить.
            </div>
          ) : (
            <Composer key={session.id} session={session} />
          )}
        </>
      ) : (
        <div className="details-scroll">
          <SessionDetails
            key={`${session.id}-${tab}`}
            session={session}
            tab={tab}
            onBackChange={onDetailBack}
          />
        </div>
      )}
      {actions && <SessionActions session={session} onClose={() => setActions(false)} />}
      {requestsOpen && (
        <Modal
          title="Запросы"
          className="request-modal"
          subtitle={session.title}
          onClose={() => setRequestsOpen(false)}
        >
          <RequestSheet questions={questions} permissions={permissions} />
        </Modal>
      )}
    </div>
  );
}

function SessionActions({ session, onClose }: { session: Session; onClose: () => void }) {
  const { client, perform, refresh, openSession, archiveSession } = usePocket();
  const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(session.share?.url);
  const operate = (operation: () => Promise<unknown>) => {
    setBusy(true);
    void perform(operation).finally(() => setBusy(false));
  };
  return (
    <Modal title="Действия с сессией" subtitle={session.directory} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          operate(async () => {
            await client!.request(`/session/${encodeURIComponent(session.id)}`, {
              method: 'PATCH',
              data: { title },
              directory: session.directory,
            });
            await refresh();
            onClose();
          });
        }}
      >
        <label>
          Название
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </label>
        <Button type="submit" variant="secondary" busy={busy}>
          <Pencil size={16} />
          Переименовать
        </Button>
      </form>
      <div className="form-stack session-action-buttons">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            operate(async () => {
              await archiveSession(session, !session.time.archived);
              onClose();
            })
          }
        >
          {session.time.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
          {session.time.archived ? 'Восстановить сессию' : 'Архивировать сессию'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            operate(async () => {
              const fork = await client!.request<Session>(`/session/${encodeURIComponent(session.id)}/fork`, {
                method: 'POST',
                data: {},
                directory: session.directory,
              });
              await refresh();
              openSession(fork);
              onClose();
            })
          }
        >
          <Split size={17} />
          Ответвить сессию
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            operate(async () => {
              const updated = await client!.request<Session>(
                `/session/${encodeURIComponent(session.id)}/share`,
                { method: 'POST', directory: session.directory },
              );
              setShare(updated.share?.url);
            })
          }
        >
          <Share2 size={17} />
          Создать публичную ссылку
        </Button>
        <p className="form-hint">
          Публичная ссылка делает историю доступной по ссылке через сервис OpenCode Share.
        </p>
        {share && (
          <>
            <div className="share-url">
              <a href={share} target="_blank" rel="noreferrer">
                {share}
              </a>
              <CopyButton text={share} />
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                operate(async () => {
                  await client!.request(`/session/${encodeURIComponent(session.id)}/share`, {
                    method: 'DELETE',
                    directory: session.directory,
                  });
                  setShare(undefined);
                })
              }
            >
              Отключить публичную ссылку
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
