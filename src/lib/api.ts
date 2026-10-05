import { CapacitorHttp } from '@capacitor/core';
import { z } from 'zod';
import { decodeEvent, normalizeServerUrl, SseDecoder, type ServerEvent } from '../../shared/protocol';
import { isNative, PocketNative } from './native';
import type { Connection, Profile, Session, Project } from '../types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Не удалось выполнить запрос'; }

function responseError(status: number, data: unknown) {
  if (status === 401) return new ApiError(status, 'Доступ отозван или пароль неверный. Подключите устройство заново.');
  let message = `Сервер ответил HTTP ${status}`;
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    if (typeof object.error === 'string') message = object.error;
    else if (typeof object.message === 'string') message = object.message;
    else if (object.data && typeof object.data === 'object' && 'message' in object.data && typeof object.data.message === 'string') message = object.data.message;
  }
  return new ApiError(status, message);
}

export async function http<T>(url: string, method = 'GET', data?: unknown, authorization?: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authorization) headers.Authorization = authorization;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (isNative) {
    const result = await CapacitorHttp.request({ url, method, headers, data,
      responseType: 'text', connectTimeout: 15_000, readTimeout: 120_000, disableRedirects: true });
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    let payload: unknown = result.data;
    if (typeof payload === 'string' && payload.length) { try { payload = JSON.parse(payload); } catch { /* HTTP error pages are handled below. */ } }
    if (result.status < 200 || result.status >= 300) throw responseError(result.status, payload);
    return (result.status === 204 ? undefined : payload) as T;
  }
  const timeout = AbortSignal.timeout(120_000);
  const result = await fetch(url, { method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', cache: 'no-store' });
  const text = await result.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  if (!result.ok) throw responseError(result.status, payload);
  if (text && payload === undefined) throw new ApiError(502, 'Сервер вернул HTML вместо OpenCode API. Проверьте адрес туннеля.');
  return payload as T;
}

export class OpenCodeClient {
  readonly authorization: string;
  readonly base: string;
  constructor(readonly connection: Connection) {
    this.base = normalizeServerUrl(connection.url);
    const bytes = new TextEncoder().encode(`${connection.username ?? 'opencode'}:${connection.credential}`);
    this.authorization = connection.mode === 'bridge' ? `Bearer ${connection.credential}` :
      connection.credential ? `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))}` : '';
  }

  url(path: string, directory?: string, companion = false) {
    const url = new URL(`${this.base}${this.connection.mode === 'bridge' && !companion ? '/api' : ''}${path}`);
    const project = directory ?? this.connection.directory;
    if (project && !companion) url.searchParams.set('directory', project);
    return url.toString();
  }

  request<T>(path: string, options: { method?: string; data?: unknown; directory?: string; signal?: AbortSignal } = {}) {
    return http<T>(this.url(path, options.directory), options.method, options.data, this.authorization, options.signal);
  }

  companion<T>(path: string, method = 'GET', data?: unknown) {
    if (this.connection.mode !== 'bridge') return Promise.reject(new Error('Для этой функции нужен OCC-мост'));
    return http<T>(this.url(`/occ${path}`, undefined, true), method, data, this.authorization);
  }

  async health() {
    return z.object({ healthy: z.boolean(), version: z.string() }).parse(await this.request('/global/health'));
  }

  async allSessions(projects: Project[]): Promise<Session[]> {
    try {
      const sessions = await this.request<Session[]>('/experimental/session?limit=200');
      if (!Array.isArray(sessions)) throw new ApiError(502, 'Некорректный список сессий');
      return sessions;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const directories = [...new Set([this.connection.directory, ...projects.flatMap((item) => [item.worktree, ...(item.sandboxes ?? [])])])];
      const sessions: Session[] = [];
      for (let index = 0; index < directories.length; index += 4) {
        const batch = await Promise.all(directories.slice(index, index + 4).map((directory) => this.request<Session[]>('/session?limit=100', { directory })));
        sessions.push(...batch.flat());
      }
      return [...new Map(sessions.map((item) => [item.id, item])).values()];
    }
  }

  async events(onEvent: (event: ServerEvent) => void, onState: (state: 'live' | 'reconnecting') => void, notifications: boolean) {
    const url = this.connection.mode === 'bridge' ? this.url('/occ/events', undefined, true) : this.url('/global/event');
    if (isNative) {
      const events = await PocketNative.addListener('serverEvent', ({ data }) => {
        try { const event = decodeEvent(JSON.parse(data)); if (event) onEvent(event); }
        catch (error) { console.error('Invalid server event', errorMessage(error)); }
      });
      const connection = await PocketNative.addListener('connection', ({ state }) => onState(state === 'connected' ? 'live' : 'reconnecting'));
      try { await PocketNative.startEvents({ url, authorization: this.authorization, notifications, name: this.connection.name }); }
      catch (error) { await events.remove(); await connection.remove(); throw error; }
      return async () => { await events.remove(); await connection.remove(); await PocketNative.stopEvents(); };
    }
    const controller = new AbortController();
    const signal = controller.signal;
    let lastID: string | undefined;
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        const attempt = new AbortController();
        const abort = () => attempt.abort();
        signal.addEventListener('abort', abort, { once: true });
        let watchdog = setTimeout(abort, 45_000);
        try {
          const result = await fetch(url, { headers: { Accept: 'text/event-stream', ...(this.authorization ? { Authorization: this.authorization } : {}),
            ...(lastID ? { 'Last-Event-ID': lastID } : {}) }, signal: attempt.signal, cache: 'no-store', redirect: 'error' });
          if (!result.ok || !result.body) throw new ApiError(result.status, 'Поток событий недоступен');
          onState('live'); failures = 0;
          const reader = result.body.getReader();
          const parser = new SseDecoder();
          try {
            while (!signal.aborted) {
              const chunk = await reader.read();
              if (chunk.done) break;
              clearTimeout(watchdog); watchdog = setTimeout(abort, 60_000);
              for (const frame of parser.feed(chunk.value)) {
                lastID = frame.id ?? lastID;
                try { const event = decodeEvent(JSON.parse(frame.data)); if (event) onEvent(event); }
                catch (error) { if (!(error instanceof SyntaxError)) throw error; }
              }
            }
          } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        } catch (error) {
          if (!signal.aborted && error instanceof ApiError && error.status === 401) {
            onEvent({ type: 'occ.unauthorized', properties: {} });
            break;
          }
        } finally { clearTimeout(watchdog); signal.removeEventListener('abort', abort); attempt.abort(); }
        if (!signal.aborted) {
          onState('reconnecting');
          await new Promise<void>((resolve) => {
            const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
            signal.addEventListener('abort', done, { once: true });
          });
        }
      }
    })();
    return async () => controller.abort();
  }
}

export async function pairDevice(url: string, code: string, name: string): Promise<Connection> {
  const base = normalizeServerUrl(url);
  const paired = z.object({ token: z.string(), deviceID: z.string(), name: z.string() }).parse(
    await http(`${base}/occ/pair`, 'POST', { code, name }));
  const profile: Profile = { id: crypto.randomUUID(), name: paired.name, url: base, mode: 'bridge', deviceID: paired.deviceID };
  return { ...profile, credential: paired.token };
}
