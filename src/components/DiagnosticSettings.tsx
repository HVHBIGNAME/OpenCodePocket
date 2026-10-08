import { useEffect, useState, useSyncExternalStore } from 'react';
import { Bug, Check, RefreshCw, Send } from 'lucide-react';
import { usePocket } from '../store/PocketProvider';
import {
  diagnosticStatus,
  flushDiagnostics,
  sendDiagnosticTest,
  subscribeDiagnostics,
} from '../lib/diagnostics';
import type { DiagnosticSummary } from '../../shared/diagnostics';
import { Button, ExternalLink, Toggle } from './ui';

export function DiagnosticSettings() {
  const { client, preferences, setPreferences, perform, notify } = usePocket();
  const local = useSyncExternalStore(subscribeDiagnostics, diagnosticStatus);
  const [remote, setRemote] = useState<DiagnosticSummary>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (client?.connection.mode !== 'bridge') return;
    let alive = true;
    const refresh = () => {
      void client
        .companion<DiagnosticSummary>('/reports')
        .then((value) => {
          if (alive) setRemote(value);
        })
        .catch(() => {
          if (alive) setRemote(undefined);
        });
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client]);
  return (
    <section className="panel settings-section">
      <div className="settings-section-title">
        <Bug size={20} />
        <div>
          <h2>Автоотчёты об ошибках</h2>
          <p>Помогают находить и исправлять сбои клиентов.</p>
        </div>
      </div>
      <Toggle
        checked={preferences.diagnostics}
        onChange={(diagnostics) => void perform(() => setPreferences({ diagnostics }))}
        label="Отправлять обезличенные отчёты"
        description="Ошибки запуска и действий → очередь на устройстве → мост → GitHub Issues."
      />
      <div className="notification-info">
        <span className="eyebrow">
          {remote?.enabled ? 'GITHUB ISSUES / AUTO REPORTS' : 'DIAGNOSTIC QUEUE'}
        </span>
        <p>
          В отчётах только версия, платформа, тип сбоя и позиции в коде. Без текста ошибок, промптов,
          исходников, ключей и адресов серверов. Повторы объединяются.
        </p>
        <div className="diagnostic-counts">
          <span>
            <Check size={13} />
            {local.queued ? `${local.queued} в очереди телефона` : 'Очередь телефона пуста'}
          </span>
          {remote && (
            <span>
              {remote.groups} групп на ПК · {remote.pending} ждут GitHub
            </span>
          )}
        </div>
        {local.deliveryError && <p>{local.deliveryError}</p>}
        {remote?.lastError && <p>{remote.lastError}</p>}
        <ExternalLink href="https://github.com/HVHBIGNAME/OpenCodePocket/blob/main/docs/diagnostics.md">
          Что собирается и как отключить
        </ExternalLink>
      </div>
      <div className="diagnostic-actions">
        <Button
          variant="secondary"
          busy={busy}
          disabled={!preferences.diagnostics || client?.connection.mode !== 'bridge'}
          onClick={() => {
            setBusy(true);
            void perform(async () => {
              await sendDiagnosticTest();
              notify('Тестовый отчёт принят мостом. GitHub-ссылка появится после обработки.');
              if (client) setRemote(await client.companion('/reports'));
            }).finally(() => setBusy(false));
          }}
        >
          <Send size={15} />
          Проверить отправку
        </Button>
        <Button
          variant="ghost"
          aria-label="Повторить отправку отчётов"
          disabled={busy || !preferences.diagnostics}
          onClick={() => void perform(() => flushDiagnostics())}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      {remote?.reports
        .filter((item) => item.issueURL)
        .slice(0, 4)
        .map((report) => (
          <div className="diagnostic-issue" key={report.fingerprint}>
            <ExternalLink href={report.issueURL!}>
              {report.name} · {report.platform}
            </ExternalLink>
            <span className="mono">×{report.count}</span>
          </div>
        ))}
      {client?.connection.mode !== 'bridge' && (
        <p className="form-hint">Отчёты отправятся после подключения через OCC-мост.</p>
      )}
    </section>
  );
}
