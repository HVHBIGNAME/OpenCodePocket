import { Bell, CheckCheck, ChevronRight, Inbox as InboxIcon } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { PermissionCard, QuestionCard } from '../components/Requests';
import { Button, EmptyState } from '../components/ui';
import { folderName } from '../lib/format';

export function Inbox() {
  const { data, pendingCount, openSession, refresh, perform, refreshing, client, setScreen } = usePocket();
  return <div className="page inbox-page"><div className="page-heading"><div><span className="eyebrow">HUMAN IN THE LOOP</span><h1>На твоей стороне<span className="heading-count">{pendingCount}</span></h1><p>Вопросы и разрешения со всех сессий.</p></div><Button variant="secondary" busy={refreshing} disabled={!client} onClick={() => void perform(() => refresh())}>Обновить</Button></div>
    <div className="inbox-summary"><span className={pendingCount ? 'warm' : 'accent'}>{pendingCount ? <Bell size={22}/> : <CheckCheck size={22}/>}</span><div><strong>{pendingCount ? `${pendingCount} запроса ждут твоего решения` : 'Всё под контролем'}</strong><p>{pendingCount ? 'Твой ответ сразу продолжит работу на компьютере.' : 'Как только OpenCode понадобится помощь, запрос появится здесь.'}</p></div></div>
    <div className="inbox-content">{data.questions.map((request) => <div key={request.id}><RequestSession sessionID={request.sessionID}/><QuestionCard request={request}/></div>)}{data.permissions.map((request) => <div key={request.id}><RequestSession sessionID={request.sessionID}/><PermissionCard request={request}/></div>)}</div>
    {!pendingCount && <section className="panel"><EmptyState icon={<InboxIcon size={32}/>} title="Можно выдохнуть" action={<Button variant="secondary" onClick={() => setScreen('sessions')}>Вернуться к сессиям<ChevronRight size={16}/></Button>}>Сейчас нет открытых вопросов и запросов доступа.</EmptyState></section>}
    <button className="notification-prompt" onClick={() => setScreen('settings')}><Bell size={20}/><span><strong>Будь на связи, даже когда OCC закрыт</strong><small>Настроить уведомления устройства</small></span><ChevronRight size={17}/></button>
  </div>;
  function RequestSession({ sessionID }: { sessionID: string }) {
    const session = data.sessions.find((item) => item.id === sessionID);
    return <button className="request-session" disabled={!session} onClick={() => session && openSession(session)}><span className="mono">{session ? folderName(session.directory) : sessionID}</span><span>{session?.title}</span><ChevronRight size={14}/></button>;
  }
}
