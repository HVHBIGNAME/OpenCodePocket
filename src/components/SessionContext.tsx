import { useMemo, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import { contextUsage } from '../lib/context-usage';
import { number } from '../lib/format';
import { Button } from './ui';
import { useSessionCommands } from './useSessionCommands';
import type { MessageEntry, Session } from '../types';

export function SessionContext({ session, entries }: { session: Session; entries: MessageEntry[] }) {
  const { connectedModels, data, perform, loadMessages } = usePocket();
  const { runBuiltin } = useSessionCommands(session, () => undefined);
  const [working, setWorking] = useState(false);
  const usage = useMemo(() => contextUsage(entries, connectedModels), [entries, connectedModels]);
  const status = data.statuses[session.id]?.type;
  const generating = status === 'busy' || status === 'retry';
  return (
    <details className="context-summary">
      <summary>
        Контекст
        {usage
          ? ` · ${usage.percent === undefined ? number(usage.used) + ' токенов' : usage.percent + '%'}`
          : ''}
      </summary>
      <div className="context-details">
        <p>
          {usage
            ? `${usage.model}: ${number(usage.used)}${usage.limit ? ' / ' + number(usage.limit) : ''} токенов по последнему ответу.`
            : 'Использование контекста появится после ответа модели.'}
        </p>
        <p>
          Это оценка по данным сервера. Сжатие сохраняет краткое содержание для продолжения длинного диалога.
        </p>
        <Button
          variant="secondary"
          busy={working}
          disabled={generating || working || !entries.some((entry) => entry.info.role === 'user')}
          onClick={() => {
            setWorking(true);
            void perform(async () => {
              await runBuiltin('compact');
              await loadMessages(session);
            }).finally(() => setWorking(false));
          }}
        >
          <Minimize2 size={16} />
          Сжать контекст
        </Button>
        {generating && <p>Сжатие доступно после завершения текущего ответа.</p>}
      </div>
    </details>
  );
}
