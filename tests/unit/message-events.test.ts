import { expect, it } from 'vitest';
import { applyEvent, emptyData, type LiveData } from '../../src/store/reducer';
import { reconcileMessages } from '../../src/store/message-events';
import type { ServerEvent } from '../../shared/protocol';
import type { Message, MessageEntry, Part } from '../../src/types';

const info: Message = {
  id: 'm',
  sessionID: 's',
  role: 'user',
  time: { created: 1 },
  agent: 'build',
  model: { providerID: 'p', modelID: 'm' },
};
const part: Part = { id: 'p', messageID: 'm', sessionID: 's', type: 'text', text: 'Hello ' };
const header: ServerEvent = { type: 'message.updated', properties: { info } };
const base: ServerEvent = { type: 'message.part.updated', properties: { part } };
const delta: ServerEvent = {
  type: 'message.part.delta',
  properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'world' },
};
const loaded = (): LiveData => ({ ...emptyData(), messages: { s: [] } });

it('drains parts before headers and deltas before parts without losing arrival order', () => {
  const original = loaded();
  let state = applyEvent(original, delta);
  state = applyEvent(state, { ...delta, properties: { ...delta.properties, delta: '!' } });
  state = applyEvent(state, base);
  expect(state.messages.s).toEqual([]);
  state = applyEvent(state, header);
  expect(state.messages.s?.[0]?.parts).toEqual([{ ...part, text: 'Hello world!' }]);
  expect(state.pendingMessages.s).toEqual([]);
  expect(original.messages.s).toEqual([]);
});

it('does not let a queued part resurrect a deleted message or deleted part', () => {
  for (const type of ['message.removed', 'message.part.removed']) {
    let state = applyEvent(loaded(), base);
    state = applyEvent(state, { type, properties: { sessionID: 's', messageID: 'm', partID: 'p' } });
    state = applyEvent(state, header);
    expect(state.messages.s?.[0]?.parts).toEqual([]);
    expect(state.pendingMessages.s).toEqual([]);
  }
});

it('bounds orphan queues and signals history recovery on count or size overflow', () => {
  let state = loaded();
  for (let count = 0; count < 129; count++) state = applyEvent(state, delta);
  expect(state.pendingMessages.s).toEqual([]);
  expect(state.needsHistory.s).toBe(true);
  state = applyEvent(loaded(), { ...delta, properties: { ...delta.properties, delta: 'x'.repeat(262144) } });
  expect(state.pendingMessages.s).toEqual([]);
  expect(state.needsHistory.s).toBe(true);
});

it('does not append a pending delta twice when an HTTP snapshot already contains it', () => {
  const snapshot: MessageEntry[] = [{ info, parts: [{ ...part, text: 'Hello world' }] }];
  const queued = applyEvent(loaded(), delta);
  const result = reconcileMessages(queued, 's', snapshot, [], queued.pendingMessages.s);
  expect(result.messages.s).toEqual(snapshot);
  expect(result.pendingMessages.s).toEqual([]);
  expect(result.needsHistory.s).toBe(false);
});

it('requests another snapshot for orphans or overflow received while history was in flight', () => {
  const queued = applyEvent(loaded(), delta);
  const result = reconcileMessages(queued, 's', [{ info, parts: [part] }], [], undefined);
  expect(result.needsHistory.s).toBe(true);
  const recovered = reconcileMessages(
    { ...result, needsHistory: { s: false } },
    's',
    [{ info, parts: [{ ...part, text: 'Hello world' }] }],
    result.messages.s!,
    result.pendingMessages.s,
  );
  expect(recovered.messages.s?.[0]?.parts[0]).toMatchObject({ text: 'Hello world' });
  expect(recovered.needsHistory.s).toBe(false);
  expect(
    reconcileMessages({ ...loaded(), needsHistory: { s: true } }, 's', [], [], undefined).needsHistory.s,
  ).toBe(true);
});

it('ignores unopened sessions and keeps new message headers chronological', () => {
  const unloaded = emptyData();
  expect(applyEvent(unloaded, delta)).toBe(unloaded);
  let state = applyEvent(loaded(), {
    ...header,
    properties: { info: { ...info, id: 'later', time: { created: 2 } } },
  });
  state = applyEvent(state, header);
  expect(state.messages.s?.map((entry) => entry.info.id)).toEqual(['m', 'later']);
});
