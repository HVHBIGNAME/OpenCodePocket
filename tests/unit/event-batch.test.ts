import { afterEach, expect, it, vi } from 'vitest';
import { eventBatch } from '../../src/store/event-batch';
import { applyEvent, emptyData } from '../../src/store/reducer';
import type { ServerEvent } from '../../shared/protocol';

afterEach(() => vi.useRealTimers());
const delta = (text: string): ServerEvent => ({
  type: 'message.part.delta',
  properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: text },
});

it('batches 200 independently arriving tokens into at most 13 renders per second without dropping text', () => {
  vi.useFakeTimers();
  let state = emptyData();
  state.messages.s = [
    {
      info: {
        id: 'm',
        sessionID: 's',
        role: 'user',
        time: { created: 0 },
        agent: 'build',
        model: { providerID: 'p', modelID: 'm' },
      },
      parts: [{ id: 'p', sessionID: 's', messageID: 'm', type: 'text', text: '' }],
    },
  ];
  const render = vi.fn((events: ServerEvent[]) => {
    state = events.reduce(applyEvent, state);
  });
  const batch = eventBatch(render);
  for (let index = 0; index < 200; index++) {
    batch.push(delta(String(index) + ' '));
    vi.advanceTimersByTime(5);
  }
  vi.runAllTimers();
  expect(render.mock.calls.length).toBeLessThanOrEqual(13);
  expect(state.messages.s![0]!.parts[0]).toMatchObject({
    text: Array.from({ length: 200 }, (_, i) => `${i} `).join(''),
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('flushes pending text before terminal/status events and explicit HTTP reconciliation', () => {
  vi.useFakeTimers();
  const render = vi.fn();
  const batch = eventBatch(render);
  const text = delta('latest');
  const idle = { type: 'session.idle', properties: { sessionID: 's' } };
  batch.push(text);
  batch.push(idle);
  expect(render).toHaveBeenCalledWith([text, idle]);
  batch.push(delta('snapshot boundary'));
  batch.flush();
  expect(render).toHaveBeenCalledTimes(2);
  vi.runAllTimers();
  expect(render).toHaveBeenCalledTimes(2);
});

it('bounds buffered events and cancels work on disconnect/background', () => {
  vi.useFakeTimers();
  const render = vi.fn();
  const batch = eventBatch(render);
  for (let i = 0; i < 256; i++) batch.push(delta('a'));
  expect(render.mock.calls[0]![0]).toHaveLength(256);
  batch.push(delta('discard'));
  batch.clear();
  vi.runAllTimers();
  expect(render).toHaveBeenCalledTimes(1);
});
