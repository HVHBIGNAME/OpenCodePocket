import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeEvent, SseDecoder, type ServerEvent } from '../../../shared/protocol';

export class EventRelay {
  private listeners = new Map<ServerResponse, string>();
  private history: { id: string; frame: string }[] = [];
  private seen = new Set<string>();
  private epoch = randomBytes(6).toString('hex');
  private sequence = 0;
  private heartbeat: ReturnType<typeof setInterval>;
  private controller = new AbortController();
  online = false;

  constructor(private deliver: (event: ServerEvent) => void) {
    this.heartbeat = setInterval(() => {
      for (const response of this.listeners.keys()) response.write(': heartbeat\n\n');
    }, 15_000);
    this.heartbeat.unref();
  }

  attach(response: ServerResponse, deviceID: string, lastID?: string) {
    this.listeners.set(response, deviceID);
    response.on('close', () => this.listeners.delete(response));
    response.write(
      `data: ${JSON.stringify({ type: 'occ.connected', properties: { online: this.online } })}\n\n`,
    );
    const index = this.history.findIndex((item) => item.id === lastID);
    if (lastID && index < 0) response.write('data: {"type":"occ.resync","properties":{}}\n\n');
    if (index >= 0) for (const item of this.history.slice(index + 1)) response.write(item.frame);
  }

  revoke(deviceID: string) {
    for (const [response, owner] of this.listeners) if (owner === deviceID) response.end();
  }

  publish(event: ServerEvent) {
    if (event.id && this.seen.has(event.id)) return;
    if (event.id) this.seen.add(event.id);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    const id = `${this.epoch}:${++this.sequence}`;
    const frame = `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
    this.history.push({ id, frame });
    if (this.history.length > 200) this.history.shift();
    for (const response of this.listeners.keys()) {
      if (response.writableLength > 2 * 1024 * 1024) response.destroy();
      else response.write(frame);
    }
    this.deliver(event);
  }

  async subscribe(url: string, authorization?: string) {
    let failures = 0;
    const signal = this.controller.signal;
    while (!signal.aborted) {
      const attempt = new AbortController();
      const stop = () => attempt.abort();
      signal.addEventListener('abort', stop, { once: true });
      let watchdog = setTimeout(stop, 45_000);
      try {
        const response = await fetch(url, {
          headers: {
            Accept: 'text/event-stream',
            ...(authorization ? { Authorization: authorization } : {}),
          },
          signal: attempt.signal,
          redirect: 'error',
        });
        if (!response.ok || !response.body) throw new Error(`OpenCode events HTTP ${response.status}`);
        this.online = true;
        failures = 0;
        this.publish({ type: 'occ.upstream', properties: { online: true } });
        const parser = new SseDecoder();
        for await (const chunk of response.body) {
          clearTimeout(watchdog);
          watchdog = setTimeout(stop, 60_000);
          for (const frame of parser.feed(chunk)) {
            try {
              const event = decodeEvent(JSON.parse(frame.data));
              if (event) this.publish(event);
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
            }
          }
        }
      } catch (error) {
        if (!signal.aborted)
          this.publish({
            type: 'occ.upstream',
            properties: {
              online: false,
              message:
                error instanceof Error && error.name !== 'AbortError'
                  ? error.message
                  : 'OpenCode connection timed out',
            },
          });
      } finally {
        this.online = false;
        clearTimeout(watchdog);
        signal.removeEventListener('abort', stop);
        attempt.abort();
      }
      if (!signal.aborted)
        await delay(Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)), undefined, { signal }).catch(
          () => undefined,
        );
    }
  }

  close() {
    this.controller.abort();
    clearInterval(this.heartbeat);
    for (const response of this.listeners.keys()) response.end();
    this.listeners.clear();
  }
}
