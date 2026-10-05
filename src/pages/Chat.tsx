import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, CheckSquare, Code2, FileCode2, GitBranch, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Share2, Split } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { folderName } from '../lib/format';
import { Button, EmptyState, IconButton, Modal, CopyButton } from '../components/ui';
import { MessageView } from '../components/MessageView';
import { QuestionCard, PermissionCard } from '../components/Requests';
import { Composer } from '../components/Composer';
import { SessionDetails } from '../components/SessionDetails';
import type { Session } from '../types';

export function Chat() {
  const { session, data, setScreen, messageLoading, loadMessages, perform } = usePocket();
  const [tab, setTab] = useState<'chat' | 'diff' | 'todos' | 'files'>('chat');
  const [actions, setActions] = useState(false);
  const [limit, setLimit] = useState(100);
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = session ? data.messages[session.id] ?? [] : [];
  const previousSession = useRef(session?.id);
  useEffect(() => { if (session?.id !== previousSession.current) { setTab('chat'); setLimit(100); setAtBottom(true); previousSession.current = session?.id; } }, [session?.id]);
  useEffect(() => { if (atBottom && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [entries, atBottom, tab]);
  if (!session) return <div className="page"><EmptyState icon={<MessageSquare size={30}/>} title="Открой сессию" action={<Button onClick={() => setScreen('sessions')}>К сессиям</Button>}>Выбери разговор, чтобы продолжить работу.</EmptyState></div>;
  const busy = data.statuses[session.id]?.type === 'busy' || data.statuses[session.id]?.type === 'retry';
  const questions = data.questions.filter((item) => item.sessionID === session.id);
  const permissions = data.permissions.filter((item) => item.sessionID === session.id);
  return <div className="chat-page"><header className="chat-heading"><IconButton label="Назад к сессиям" onClick={() => setScreen('sessions')}><ArrowLeft size={20}/></IconButton><div><span className="eyebrow"><GitBranch size={12}/>{folderName(session.directory)}</span><h1>{session.title}</h1></div><span className={`status-pill ${busy ? 'status-live' : 'status-idle'}`}><span className={busy ? 'live-dot' : 'neutral-dot'}/>{busy ? 'В работе' : 'На связи'}</span><IconButton label="Действия с сессией" onClick={() => setActions(true)}><MoreHorizontal size={21}/></IconButton></header>
    <nav className="chat-tabs" aria-label="Содержимое сессии">{([['chat', MessageSquare, 'Диалог'],['diff', Code2, 'Изменения'],['todos', CheckSquare, 'Задачи'],['files', FileCode2, 'Файлы']] as const).map(([value, Icon, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon size={16}/>{label}{value === 'diff' && session.summary && <span>{session.summary.files}</span>}</button>)}</nav>
    {tab === 'chat' ? <><div className="chat-scroll" ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 100); }}><div className="messages-inner">{entries.length >= limit && <div className="load-history"><Button variant="ghost" busy={messageLoading} onClick={() => { const next = limit + 100; setLimit(next); void perform(() => loadMessages(session, next)); }}>Загрузить более ранние сообщения</Button></div>}{!entries.length && (messageLoading ? <div className="loading-state"><LoaderCircle size={22} className="spin"/>Загружаем контекст…</div> : <EmptyState icon={<Code2 size={28}/>} title="Место для следующей идеи">Напиши задачу или надиктуй её — OpenCode продолжит на компьютере.</EmptyState>)}{entries.map((entry) => <MessageView key={entry.info.id} entry={entry}/>)}{busy && <div className="thinking-indicator"><span/><span/><span/><span className="mono">OpenCode работает</span></div>}{questions.map((request) => <QuestionCard key={request.id} request={request}/>)}{permissions.map((request) => <PermissionCard key={request.id} request={request}/>)}</div></div>{!atBottom && <button className="jump-bottom" onClick={() => setAtBottom(true)}><ArrowDown size={17}/>К последнему</button>}<Composer key={session.id} session={session}/></> : <div className="details-scroll"><SessionDetails key={`${session.id}-${tab}`} session={session} tab={tab}/></div>}
    {actions && <SessionActions session={session} onClose={() => setActions(false)}/>}
  </div>;
}

function SessionActions({ session, onClose }: { session: Session; onClose: () => void }) {
  const { client, perform, refresh, openSession } = usePocket();
  const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(session.share?.url);
  const operate = (operation: () => Promise<unknown>) => { setBusy(true); void perform(operation).finally(() => setBusy(false)); };
  return <Modal title="Сессия под рукой" subtitle={session.directory} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); operate(async () => { await client!.request(`/session/${encodeURIComponent(session.id)}`, { method: 'PATCH', data: { title }, directory: session.directory }); await refresh(); onClose(); }); }}><label>Название<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200}/></label><Button type="submit" variant="secondary" busy={busy}><Pencil size={16}/>Переименовать</Button></form><div className="form-stack session-action-buttons"><Button variant="secondary" disabled={busy} onClick={() => operate(async () => { const fork = await client!.request<Session>(`/session/${encodeURIComponent(session.id)}/fork`, { method: 'POST', data: {}, directory: session.directory }); await refresh(); openSession(fork); onClose(); })}><Split size={17}/>Ответвить сессию</Button><Button variant="secondary" disabled={busy} onClick={() => operate(async () => { const updated = await client!.request<Session>(`/session/${encodeURIComponent(session.id)}/share`, { method: 'POST', directory: session.directory }); setShare(updated.share?.url); })}><Share2 size={17}/>Создать публичную ссылку</Button><p className="form-hint">Публичная ссылка делает историю доступной по ссылке через сервис OpenCode Share.</p>{share && <><div className="share-url"><a href={share} target="_blank" rel="noreferrer">{share}</a><CopyButton text={share}/></div><Button variant="ghost" onClick={() => operate(async () => { await client!.request(`/session/${encodeURIComponent(session.id)}/share`, { method: 'DELETE', directory: session.directory }); setShare(undefined); })}>Отключить публичную ссылку</Button></>}</div></Modal>;
}
