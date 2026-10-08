import { Bell, ChevronRight, Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { PermissionCard, QuestionCard } from '../components/Requests';
import { Button, EmptyState, IconButton } from '../components/ui';
import { folderName } from '../lib/format';

export function Inbox() {
  const { data, pendingCount, openSession, refresh, perform, refreshing, client, setScreen } = usePocket();
  return (
    <div className="page inbox-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВОПРОСЫ И ДОСТУП</span>
          <h1>
            Запросы<span className="heading-count">{pendingCount}</span>
          </h1>
          <p>Твой ответ продолжит работу на компьютере.</p>
        </div>
        <IconButton
          label="Обновить запросы"
          disabled={!client || refreshing}
          onClick={() => void perform(() => refresh())}
        >
          <RefreshCw size={21} className={refreshing ? 'spin' : ''} />
        </IconButton>
      </div>
      <div className="inbox-content">
        {data.questions.map((request) => (
          <div key={request.id}>
            <RequestSession sessionID={request.sessionID} />
            <QuestionCard request={request} />
          </div>
        ))}
        {data.permissions.map((request) => (
          <div key={request.id}>
            <RequestSession sessionID={request.sessionID} />
            <PermissionCard request={request} />
          </div>
        ))}
      </div>
      {!pendingCount && (
        <section className="panel">
          <EmptyState
            icon={<InboxIcon size={32} />}
            title="Можно выдохнуть"
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
      <button className="notification-prompt" onClick={() => setScreen('settings')}>
        <Bell size={20} />
        <span>
          <strong>Будь на связи, даже когда OCC закрыт</strong>
          <small>Настроить уведомления устройства</small>
        </span>
        <ChevronRight size={17} />
      </button>
    </div>
  );
  function RequestSession({ sessionID }: { sessionID: string }) {
    const session = data.sessions.find((item) => item.id === sessionID);
    return (
      <button className="request-session" disabled={!session} onClick={() => session && openSession(session)}>
        <span className="mono">{session ? folderName(session.directory) : sessionID}</span>
        <span>{session?.title}</span>
        <ChevronRight size={14} />
      </button>
    );
  }
}
