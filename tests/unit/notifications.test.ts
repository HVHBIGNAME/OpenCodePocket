import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationGate } from '../../shared/notification-policy';
import { notificationFor, type ServerEvent } from '../../shared/protocol';
import { PushService } from '../../packages/bridge/src/push';
import { DeviceStore } from '../../packages/bridge/src/state';

afterEach(() => vi.unstubAllGlobals());

function asked(id = 'q1', sessionID = 's1'): ServerEvent {
  return { type: 'question.asked', properties: { id, sessionID } };
}

describe('notification policy', () => {
  it('ignores cancellation, connection events and unscoped errors', () => {
    for (const event of [
      { type: 'session.error', properties: { sessionID: 's1', error: { name: 'MessageAbortedError' } } },
      { type: 'session.error', properties: { error: { name: 'UnknownError' } } },
      { type: 'occ.connected', properties: { online: true } },
      { type: 'question.replied', properties: { sessionID: 's1', requestID: 'q1' } },
    ])
      expect(notificationFor(event)).toBeUndefined();
  });
  it('deduplicates request aliases and replays even with different transport IDs', () => {
    const gate = new NotificationGate();
    expect(gate.accept({ ...asked(), id: 'evt-1' }, 0)).toBe(true);
    expect(gate.accept({ ...asked(), type: 'question.v2.asked', id: 'evt-2' }, 20000)).toBe(false);
    expect(gate.accept(asked('q2'), 21000)).toBe(true);
    expect(gate.accept(asked('q3'), 22000)).toBe(true);
    expect(gate.accept(asked('q4', 's2'), 22000)).toBe(true);
  });
  it('limits error bursts but lets subsequent errors without IDs through', () => {
    const gate = new NotificationGate();
    const error = { type: 'session.error', properties: { sessionID: 's1', error: { name: 'APIError' } } };
    expect(gate.accept(error, 0)).toBe(true);
    expect(gate.accept(error, 1000)).toBe(false);
    expect(gate.accept(error, 61000)).toBe(true);
  });
});

describe('push delivery', () => {
  function setup() {
    const store = new DeviceStore('unused');
    store.devices = ['a', 'b'].map((id) => ({
      id,
      name: id,
      tokenHash: 'test',
      created: 0,
      ntfyTopic: `occ-${id.repeat(48)}`,
    }));
    const log = vi.fn();
    return { service: new PushService({}, store, log), store, log };
  }
  it('tests only the requesting device and reports provider rejection honestly', async () => {
    const { service, log } = setup();
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await service.test('a')).toEqual({ attempted: 1, delivered: 0, failed: 1 });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).topic).toBe(`occ-${'a'.repeat(48)}`);
    expect(log).toHaveBeenCalledWith('Push delivery failed: ntfy HTTP 429');
  });
  it('delivers requests once, skips revoked channels and includes only generic text', async () => {
    const { service, store } = setup();
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await service.dispatch({
      ...asked(),
      properties: { ...asked().properties, questions: ['secret prompt'] },
    });
    await service.dispatch(asked());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('secret prompt');
    store.devices = [];
    expect(await service.test('a')).toEqual({ attempted: 0, delivered: 0, failed: 0 });
  });
});
