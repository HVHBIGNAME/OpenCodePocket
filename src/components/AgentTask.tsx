import { useState } from 'react';
import { Bot, ChevronRight, LoaderCircle } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { taskSessionID } from '../lib/subagents';
import { Button } from './ui';
import { RichText } from './RichText';
import type { Part } from '../types';

export function AgentTask({ part }: { part: Extract<Part, { type: 'tool' }> }) {
  const { data, session, openRelatedSession, perform } = usePocket();
  const [opening, setOpening] = useState(false);
  const id = taskSessionID(part);
  const child = data.sessions.find((item) => item.id === id);
  const waiting =
    data.questions.some((item) => item.sessionID === id) ||
    data.permissions.some((item) => item.sessionID === id);
  const status = id ? data.statuses[id]?.type : undefined;
  const busy =
    status === 'busy' ||
    status === 'retry' ||
    (!status && ['pending', 'running'].includes(part.state.status));
  const title =
    typeof part.state.input.description === 'string'
      ? part.state.input.description
      : (child?.title ?? 'Задача агента');
  const agent =
    typeof part.state.input.subagent_type === 'string'
      ? part.state.input.subagent_type
      : (child?.agent ?? 'Агент');
  return (
    <section className="agent-task" aria-label={`Задача агента: ${title}`}>
      <div className="agent-task-heading">
        <Bot size={18} />
        <strong>{title}</strong>
      </div>
      <div className="agent-task-status">
        <span>{agent}</span>
        {busy && <LoaderCircle size={14} className="spin" />}
        <span>
          {waiting
            ? 'Ждёт ответа'
            : busy
              ? 'В работе'
              : part.state.status === 'error'
                ? 'Ошибка'
                : 'Завершена'}
        </span>
      </div>
      <Button
        variant="secondary"
        disabled={!id || !session}
        busy={opening}
        onClick={() => {
          if (!id || !session) return;
          setOpening(true);
          void perform(() => openRelatedSession(id, session.directory)).finally(() => setOpening(false));
        }}
      >
        Открыть диалог агента
        <ChevronRight size={16} />
      </Button>
      {!id && <p className="form-hint">Сервер ещё не передал ссылку на сессию агента.</p>}
      <details className="agent-task-details">
        <summary>Задание и результат</summary>
        {typeof part.state.input.prompt === 'string' && <RichText text={part.state.input.prompt} />}
        {part.state.status === 'completed' && <RichText text={part.state.output} />}
        {part.state.status === 'error' && <p className="inline-error">{part.state.error}</p>}
      </details>
    </section>
  );
}
