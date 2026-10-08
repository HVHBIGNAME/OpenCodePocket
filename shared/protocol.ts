import { z } from 'zod';

export const APP_VERSION = '1.0.0';
export const APP_ID = 'dev.hvhbigname.occ';

export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (['localhost', '::1'].includes(name) || name.endsWith('.local')) return true;
  if (/^(fc|fd)[0-9a-f]{2}:|^fe80:/i.test(name)) return true;
  const pieces = name.split('.').map(Number);
  if (pieces.length !== 4 || pieces.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = pieces;
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127)
  );
}

export function normalizeServerUrl(input: string): string {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Нужен адрес http:// или https://');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Укажите адрес сервера без пароля, параметров и #');
  if (url.protocol === 'http:' && !isPrivateHost(url.hostname))
    throw new Error('Для публичного сервера требуется HTTPS. HTTP доступен в локальной сети или VPN.');
  return url.toString().replace(/\/+$/, '');
}

export const PairingSchema = z.object({
  url: z.string().transform(normalizeServerUrl),
  code: z.string().min(12).max(128),
  name: z.string().max(100).optional(),
});
export type Pairing = z.infer<typeof PairingSchema>;

export function pairingLink(pairing: Pairing): string {
  const query = new URLSearchParams({ url: pairing.url, code: pairing.code });
  if (pairing.name) query.set('name', pairing.name);
  return `occ://pair?${query}`;
}

export function parsePairing(value: string): Pairing {
  const text = value.trim();
  if (text.startsWith('{')) return PairingSchema.parse(JSON.parse(text));
  const link = new URL(text);
  if (link.protocol !== 'occ:' || link.hostname !== 'pair') throw new Error('Это не QR-код подключения OCC');
  return PairingSchema.parse(Object.fromEntries(link.searchParams));
}

export type ServerEvent = {
  id?: string;
  type: string;
  properties: Record<string, unknown>;
  directory?: string;
};

export function decodeEvent(value: unknown): ServerEvent | undefined {
  if (!value || typeof value !== 'object') return;
  const envelope = value as Record<string, unknown>;
  const inner =
    envelope.payload && typeof envelope.payload === 'object'
      ? (envelope.payload as Record<string, unknown>)
      : envelope;
  if (typeof inner.type !== 'string') return;
  const properties = inner.properties ?? inner.data;
  return {
    id: typeof inner.id === 'string' ? inner.id : undefined,
    type: inner.type,
    properties: properties && typeof properties === 'object' ? (properties as Record<string, unknown>) : {},
    directory: typeof envelope.directory === 'string' ? envelope.directory : undefined,
  };
}

export type SseMessage = { data: string; id?: string; event?: string };

/** Incremental SSE decoder; supports split UTF-8, CRLF, multiline data, and comments. */
export class SseDecoder {
  private buffer = '';
  private data: string[] = [];
  private id: string | undefined;
  private event: string | undefined;
  private decoder = new TextDecoder();

  feed(chunk: Uint8Array | string): SseMessage[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const messages: SseMessage[] = [];
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      if (!line) {
        if (this.data.length) messages.push({ data: this.data.join('\n'), id: this.id, event: this.event });
        this.data = [];
        this.event = undefined;
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const key = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (key === 'data') this.data.push(value);
      if (key === 'id' && !value.includes('\0')) this.id = value;
      if (key === 'event') this.event = value;
    }
    if (this.buffer.length > 8 * 1024 * 1024) throw new Error('SSE event exceeds 8 MB');
    return messages;
  }
}

export function notificationFor(
  event: ServerEvent,
): { title: string; body: string; sessionID?: string } | undefined {
  const sessionID = typeof event.properties.sessionID === 'string' ? event.properties.sessionID : undefined;
  if (event.type === 'permission.asked' || event.type === 'permission.v2.asked') {
    return { title: 'OpenCode ждёт разрешения', body: 'Откройте OCC, чтобы проверить действие.', sessionID };
  }
  if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
    return { title: 'У OpenCode есть вопрос', body: 'Ваш ответ нужен для продолжения работы.', sessionID };
  }
  if (event.type === 'session.error')
    return {
      title: 'OpenCode: нужна помощь',
      body: 'В сессии произошла ошибка. Подробности в OCC.',
      sessionID,
    };
  return;
}
