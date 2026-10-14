import { useState } from 'react';
import { ChevronRight, GitBranch } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { agentSessions, sessionActivity } from '../lib/session-tree';
import { Modal } from './ui';

export function AgentSessions({ parentID }: { parentID: string }) {
  const { data, perform, openRelatedSession } = usePocket();
  const [open, setOpen] = useState(false);
  const rows = agentSessions(data.sessions, parentID);
  const activity = sessionActivity(data);
  if (!rows.length) return null;
  const waiting = rows.some(({ session }) => activity.waiting.has(session.id));
  const busy = rows.some(({ session }) => activity.busy.has(session.id));
  return (
    <>
      <button
        className="agents-summary"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GitBranch size={15} />
        <span>Агенты · {rows.length}</span>
        {(waiting || busy) && <small>{waiting ? 'Ждут ответа' : 'В работе'}</small>}
        <ChevronRight size={15} />
      </button>
      {open && (
        <Modal
          title="Агенты сессии"
          subtitle="Подзадачи этого диалога. У каждого агента своя история."
          onClose={() => setOpen(false)}
        >
          <div className="agent-session-list">
            {rows.map(({ session, depth }) => (
              <button
                key={session.id}
                className="option-row"
                style={{ paddingInlineStart: 14 + Math.min(depth, 5) * 14 }}
                onClick={() =>
                  void perform(async () => {
                    await openRelatedSession(session.id, session.directory);
                    setOpen(false);
                  })
                }
              >
                <GitBranch size={17} />
                <span>
                  <strong>{session.title}</strong>
                  <small>
                    {session.time.archived
                      ? 'В архиве'
                      : activity.waiting.has(session.id)
                        ? 'Ждёт ответа'
                        : activity.busy.has(session.id)
                          ? 'В работе'
                          : 'Завершён'}
                    {depth > 0 ? ` · вложенность ${depth + 1}` : ''}
                  </small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
