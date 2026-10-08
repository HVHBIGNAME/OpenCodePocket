import { APP_VERSION } from '../../shared/protocol';
import { DiagnosticSchema, errorShape, type Diagnostic } from '../../shared/diagnostics';
import { isNative, platform, vaultRead, vaultWrite } from './native';
import type { OpenCodeClient } from './api';

type LocalStatus = { enabled: boolean; queued: number; lastSent?: number; deliveryError?: string };
let status: LocalStatus = { enabled: true, queued: 0 };
let queue: Diagnostic[] = [];
let initialized = false;
let initTask: Promise<void> | undefined;
let client: OpenCodeClient | undefined;
let worker: Promise<void> | undefined;
let screen: Diagnostic['screen'] = 'startup';
let writes = Promise.resolve();
let installed = false;
const captured = new WeakSet<object>();
const recent = new Map<string, number>();
const subscribers = new Set<() => void>();

export const diagnosticStatus = () => status;
export const subscribeDiagnostics = (listener: () => void) => {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
};
function update(patch: Partial<LocalStatus> = {}) {
  status = { ...status, queued: queue.length, ...patch };
  for (const listener of subscribers) listener();
}
function persist() {
  const snapshot = [...queue];
  const task = writes.then(() => vaultWrite('occ.diagnostics.queue', snapshot));
  writes = task.catch(() => {
    update({ deliveryError: 'Не удалось сохранить очередь диагностики на устройстве.' });
  });
  return task;
}

export function captureDiagnostic(
  error: unknown,
  context: { kind?: Diagnostic['kind']; operation?: Diagnostic['operation']; fatal?: boolean } = {},
) {
  if (!status.enabled) return;
  if (error && typeof error === 'object') {
    if (captured.has(error)) return;
    captured.add(error);
  }
  const shape = errorShape(error);
  if (shape.name === 'AbortError') return;
  const report: Diagnostic = {
    schema: 1,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    version: APP_VERSION,
    platform: platform === 'android' || platform === 'ios' ? platform : 'web',
    kind: context.kind ?? 'action',
    severity: context.fatal ? 'fatal' : shape.httpStatus && shape.httpStatus < 500 ? 'warning' : 'error',
    operation: context.operation ?? 'unknown',
    screen,
    ...shape,
  };
  const signature = JSON.stringify([report.name, report.frames, report.kind, report.operation]);
  if (Date.now() - (recent.get(signature) ?? 0) < 60_000) return;
  recent.set(signature, Date.now());
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
  if (!DiagnosticSchema.safeParse(report).success) return;
  queue = [...queue, report].slice(-100);
  update();
  if (initialized)
    void persist()
      .then(() => flushDiagnostics())
      .catch(() => undefined);
}

export function setDiagnosticScreen(value: Diagnostic['screen']) {
  screen = value;
}

export function initializeDiagnostics() {
  if (initTask) return initTask;
  initTask = (async () => {
    const prefs = await vaultRead<{ diagnostics?: boolean }>('occ.preferences');
    update({ enabled: prefs?.diagnostics !== false });
    const stored = status.enabled ? ((await vaultRead<unknown[]>('occ.diagnostics.queue')) ?? []) : [];
    const native =
      status.enabled && isNative ? ((await vaultRead<unknown[]>('occ.nativeReports')) ?? []) : [];
    const parsed = [...stored, ...native, ...queue]
      .map((item) => DiagnosticSchema.safeParse(item))
      .filter((result) => result.success)
      .map((result) => result.data);
    queue = status.enabled ? [...new Map(parsed.map((item) => [item.id, item])).values()].slice(-100) : [];
    initialized = true;
    update();
    await persist();
    if (isNative) await vaultWrite('occ.nativeReports', []);
    await flushDiagnostics();
  })().catch(() => {
    initialized = true;
    update({ deliveryError: 'Очередь диагностики недоступна до восстановления защищённого хранилища.' });
  });
  return initTask;
}

export async function setDiagnosticsEnabled(enabled: boolean) {
  await initializeDiagnostics();
  update({ enabled });
  if (!enabled) {
    queue = [];
    recent.clear();
    update({ deliveryError: undefined });
    await persist();
    if (isNative) await vaultWrite('occ.nativeReports', []);
  } else await flushDiagnostics();
}

export function attachDiagnosticClient(value?: OpenCodeClient) {
  client = value;
  void initializeDiagnostics().then(() => flushDiagnostics());
}

export function flushDiagnostics(): Promise<void> {
  if (worker) return worker;
  const target = client;
  if (!initialized || !status.enabled || !queue.length || target?.connection.mode !== 'bridge')
    return Promise.resolve();
  worker = (async () => {
    while (status.enabled && queue.length && client === target) {
      const batch = queue.slice(0, 20);
      const result = await target.companion<{ accepted: string[] }>('/reports', 'POST', { reports: batch });
      if (!Array.isArray(result.accepted) || !result.accepted.length)
        throw new Error('Invalid diagnostics receipt');
      queue = queue.filter((report) => !result.accepted.includes(report.id));
      update({ lastSent: Date.now(), deliveryError: undefined });
      await persist();
    }
  })()
    .catch(() => {
      update({ deliveryError: 'Отчёты остаются в очереди. Повторим отправку после восстановления связи.' });
    })
    .finally(() => {
      worker = undefined;
    });
  return worker;
}

export async function sendDiagnosticTest() {
  if (!status.enabled) throw new Error('Сначала включите автоотчёты');
  if (client?.connection.mode !== 'bridge')
    throw new Error('Для отправки отчёта подключитесь через OCC-мост');
  queue.push({
    schema: 1,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    version: APP_VERSION,
    platform: platform === 'android' || platform === 'ios' ? platform : 'web',
    kind: 'test',
    severity: 'warning',
    name: 'DiagnosticSmokeTest',
    operation: 'unknown',
    screen: 'settings',
    frames: ['diagnostics.ts:1:1'],
  });
  update();
  await persist();
  await flushDiagnostics();
  if (status.deliveryError) throw new Error(status.deliveryError);
}

export function installDiagnosticHandlers() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) =>
    captureDiagnostic(event.error, { kind: 'unhandled', fatal: true }),
  );
  window.addEventListener('unhandledrejection', (event) =>
    captureDiagnostic(event.reason, { kind: 'unhandled' }),
  );
  window.addEventListener('online', () => {
    void flushDiagnostics();
  });
  setInterval(() => {
    void flushDiagnostics();
  }, 60_000);
  void initializeDiagnostics();
}
