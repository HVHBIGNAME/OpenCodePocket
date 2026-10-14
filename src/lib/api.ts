import { CapacitorHttp } from '@capacitor/core';
import { z } from 'zod';
import { decodeEvent, normalizeServerUrl, SseDecoder, type ServerEvent } from '../../shared/protocol';
import { isNative, platform, PocketNative } from './native';
import type { Connection, Profile, Session, Project } from '../types';
import { captureDiagnostic } from './diagnostics';
import { diagnosticOperation } from '../../shared/diagnostics';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос';
}

function responseError(status: number, data: unknown) {
  if (status === 401)
    return new ApiError(status, 'Доступ отозван или пароль неверный. Подключите устройство заново.');
  let message = `Сервер ответил HTTP ${status}`;
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    if (typeof object.error === 'string') message = object.error;
    else if (typeof object.message === 'string') message = object.message;
    else if (
      object.data &&
      typeof object.data === 'object' &&
      'message' in object.data &&
      typeof object.data.message === 'string'
    )
      message = object.data.message;
  }
  return new ApiError(status, message);
}

export async function http<T>(
  url: string,
  method = 'GET',
  data?: unknown,
  authorization?: string,
  signal?: AbortSignal,
  timeoutMs = method === 'GET' ? 30_000 : 120_000,
): Promise<T> {
  signal?.throwIfAborted();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (isNative) {
    const result = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
      responseType: 'text',
      // Capacitor iOS uses connectTimeout as the timeout for the entire URLRequest.
      connectTimeout: platform === 'ios' ? timeoutMs : Math.min(timeoutMs, 15_000),
      readTimeout: timeoutMs,
      disableRedirects: true,
    });
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    let payload: unknown = result.data;
    let invalidJSON = false;
    if (typeof payload === 'string' && payload.length) {
      try {
        payload = JSON.parse(payload);
      } catch {
        invalidJSON = true;
      }
    }
    if (result.status < 200 || result.status >= 300) throw responseError(result.status, payload);
    if (invalidJSON && result.status !== 204)
      throw new ApiError(502, 'Сервер вернул HTML вместо OpenCode API. Проверьте адрес туннеля.');
    return (result.status === 204 || payload === '' ? undefined : payload) as T;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const result = await fetch(url, {
    method,
    headers,
    ...(data !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())
      ? { body: JSON.stringify(data) }
      : {}),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
    cache: 'no-store',
  });
  const text = await result.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!result.ok) throw responseError(result.status, payload);
  if (text && payload === undefined)
    throw new ApiError(502, 'Сервер вернул HTML вместо OpenCode API. Проверьте адрес туннеля.');
  return payload as T;
}

function waitForReadRetry(signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 400);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function retryRead<T>(request: (timeout: number) => Promise<T>, timeout: number, signal?: AbortSignal) {
  const started = Date.now();
  try {
    return await request(timeout);
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      ![502, 503, 504].includes(error.status) ||
      signal?.aborted ||
      Date.now() - started + 400 >= timeout
    )
      throw error;
    await waitForReadRetry(signal);
    return request(Math.max(1, timeout - (Date.now() - started)));
  }
}

export class OpenCodeClient {
  readonly authorization: string;
  readonly base: string;
  constructor(readonly connection: Connection) {
    this.base = normalizeServerUrl(connection.url);
    const bytes = new TextEncoder().encode(`${connection.username ?? 'opencode'}:${connection.credential}`);
    this.authorization =
      connection.mode === 'bridge'
        ? `Bearer ${connection.credential}`
        : connection.credential
          ? `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}`
          : '';
  }

  url(path: string, directory?: string, companion = false) {
    const url = new URL(
      `${this.base}${this.connection.mode === 'bridge' && !companion ? '/api' : ''}${path}`,
    );
    const project = directory ?? this.connection.directory;
    if (project && !companion) url.searchParams.set('directory', project);
    return url.toString();
  }

  request<T>(
    path: string,
    options: {
      method?: string;
      data?: unknown;
      directory?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ) {
    const execute = (timeout = options.timeoutMs) =>
      http<T>(
        this.url(path, options.directory),
        options.method,
        options.data,
        this.authorization,
        options.signal,
        timeout,
      );
    const operation =
      (options.method ?? 'GET').toUpperCase() === 'GET'
        ? retryRead(execute, options.timeoutMs ?? 30000, options.signal)
        : execute();
    return operation.catch((error: unknown) => {
      if (!options.signal?.aborted)
        captureDiagnostic(error, { kind: 'request', operation: diagnosticOperation(path) });
      throw error;
    });
  }

  companion<T>(path: string, method = 'GET', data?: unknown) {
    if (this.connection.mode !== 'bridge')
      return Promise.reject(new Error('Для этой функции нужен OCC-мост'));
    return http<T>(this.url(`/occ${path}`, undefined, true), method, data, this.authorization);
  }

  async health() {
    return z
      .object({ healthy: z.boolean(), version: z.string() })
      .parse(await this.request('/global/health', { timeoutMs: 10_000 }));
  }

  async allSessions(projects: Project[]): Promise<Session[]> {
    try {
      const sessions = await this.request<Session[]>('/experimental/session?limit=200&archived=true');
      if (!Array.isArray(sessions)) throw new ApiError(502, 'Некорректный список сессий');
      return sessions;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const directories = [
        ...new Set([
          this.connection.directory,
          ...projects.flatMap((item) => [item.worktree, ...(item.sandboxes ?? [])]),
        ]),
      ];
      const sessions: Session[] = [];
      for (let index = 0; index < directories.length; index += 4) {
        const batch = await Promise.all(
          directories
            .slice(index, index + 4)
            .map((directory) => this.request<Session[]>('/session?limit=100', { directory })),
        );
        sessions.push(...batch.flat());
      }
      return [...new Map(sessions.map((item) => [item.id, item])).values()];
    }
  }

  async events(
    onEvent: (event: ServerEvent) => void,
    onState: (state: 'live' | 'reconnecting') => void,
    notifications: boolean,
  ) {
    const url =
      this.connection.mode === 'bridge'
        ? this.url('/occ/events', undefined, true)
        : this.url('/global/event');
    const seen = new Set<string>();
    const deliver = (event: ServerEvent) => {
      if (event.id) {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        if (seen.size > 2048) seen.delete(seen.values().next().value!);
      }
      onEvent(event);
    };
    if (isNative) {
      const events = await PocketNative.addListener('serverEvent', ({ data }) => {
        try {
          const event = decodeEvent(JSON.parse(data));
          if (event) deliver(event);
        } catch (error) {
          console.error('Invalid server event', errorMessage(error));
        }
      });
      const connection = await PocketNative.addListener('connection', ({ state }) =>
        onState(state === 'connected' ? 'live' : 'reconnecting'),
      );
      try {
        await PocketNative.startEvents({
          url,
          authorization: this.authorization,
          notifications,
          name: this.connection.name,
        });
      } catch (error) {
        await events.remove();
        await connection.remove();
        throw error;
      }
      return async () => {
        await events.remove();
        await connection.remove();
        await PocketNative.stopEvents();
      };
    }
    const controller = new AbortController();
    const signal = controller.signal;
    let lastID: string | undefined;
    let activeAttempt: AbortController | undefined;
    let wakeRetry: (() => void) | undefined;
    let lastActivity = 0;
    const wake = () => {
      if (signal.aborted || document.hidden) return;
      wakeRetry?.();
      if (Date.now() - lastActivity > 20_000) activeAttempt?.abort();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        const attempt = new AbortController();
        activeAttempt = attempt;
        const abort = () => attempt.abort();
        signal.addEventListener('abort', abort, { once: true });
        let watchdog = setTimeout(abort, 45_000);
        try {
          const result = await fetch(url, {
            headers: {
              Accept: 'text/event-stream',
              ...(this.authorization ? { Authorization: this.authorization } : {}),
              ...(lastID ? { 'Last-Event-ID': lastID } : {}),
            },
            signal: attempt.signal,
            cache: 'no-store',
            redirect: 'error',
          });
          if (!result.ok || !result.body) throw new ApiError(result.status, 'Поток событий недоступен');
          if (!result.headers.get('content-type')?.includes('text/event-stream'))
            throw new ApiError(502, 'Адрес вернул страницу вместо потока событий OpenCode');
          onState('live');
          lastActivity = Date.now();
          failures = 0;
          const reader = result.body.getReader();
          const parser = new SseDecoder();
          try {
            while (!signal.aborted) {
              const chunk = await reader.read();
              if (chunk.done) break;
              lastActivity = Date.now();
              clearTimeout(watchdog);
              watchdog = setTimeout(abort, 60_000);
              for (const frame of parser.feed(chunk.value)) {
                lastID = frame.id ?? lastID;
                try {
                  const event = decodeEvent(JSON.parse(frame.data));
                  if (event) deliver(event);
                } catch (error) {
                  if (!(error instanceof SyntaxError)) throw error;
                }
              }
              if (parser.lastEventID !== undefined) lastID = parser.lastEventID;
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
        } catch (error) {
          if (!signal.aborted && error instanceof ApiError && error.status === 401) {
            onEvent({ type: 'occ.unauthorized', properties: {} });
            break;
          }
        } finally {
          clearTimeout(watchdog);
          signal.removeEventListener('abort', abort);
          attempt.abort();
          if (activeAttempt === attempt) activeAttempt = undefined;
        }
        if (!signal.aborted) {
          onState('reconnecting');
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener('abort', done);
              resolve();
            };
            wakeRetry = done;
            const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
            signal.addEventListener('abort', done, { once: true });
          });
          wakeRetry = undefined;
        }
      }
    })();
    return async () => {
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      controller.abort();
      wakeRetry?.();
    };
  }
}

export async function pairDevice(url: string, code: string, name: string): Promise<Connection> {
  const base = normalizeServerUrl(url);
  const paired = z
    .object({ token: z.string(), deviceID: z.string(), name: z.string() })
    .parse(await http(`${base}/occ/pair`, 'POST', { code, name }));
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: paired.name,
    url: base,
    mode: 'bridge',
    deviceID: paired.deviceID,
  };
  return { ...profile, credential: paired.token };
}
