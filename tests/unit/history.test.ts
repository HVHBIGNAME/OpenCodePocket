import { describe, expect, it } from 'vitest';
import { mergeHistory, mergeSnapshot } from '../../src/store/history';
import { applyEvent, emptyData } from '../../src/store/reducer';
import type { MessageEntry } from '../../src/types';

const message = (id: string, created: number, text: string): MessageEntry => ({
  info: {
    id,
    sessionID: 's',
    role: 'user',
    time: { created },
    agent: 'build',
    model: { providerID: 'p', modelID: 'm' },
  },
  parts: [{ id: `p_${id}`, messageID: id, sessionID: 's', type: 'text', text }],
});

describe('history snapshot reconciliation', () => {
  it('does not restore answered requests or old sessions after a delayed refresh', () => {
    const before = [{ id: 'answered' }, { id: 'changed', title: 'before' }];
    const current = [{ id: 'changed', title: 'renamed' }, { id: 'new' }];
    const snapshot = [{ id: 'answered' }, { id: 'changed', title: 'before' }, { id: 'another' }];
    expect(mergeSnapshot(snapshot, before, current)).toEqual([
      { id: 'changed', title: 'renamed' },
      { id: 'another' },
      { id: 'new' },
    ]);
  });
  it('keeps streamed text while inserting earlier messages from a slow snapshot', () => {
    const before = [message('m', 2, 'Start')];
    const live = applyEvent(
      { ...emptyData(), messages: { s: before } },
      {
        type: 'message.part.delta',
        properties: { sessionID: 's', messageID: 'm', partID: 'p_m', field: 'text', delta: ' streamed' },
      },
    ).messages.s!;
    const result = mergeHistory([message('old', 1, 'History'), message('m', 2, 'Start')], before, live);
    expect(result.map((entry) => entry.info.id)).toEqual(['old', 'm']);
    expect(result[1]!.parts[0]).toMatchObject({ text: 'Start streamed' });
    expect(mergeHistory([message('m', 2, 'Start streamed')], before, live)[0]!.parts[0]).toMatchObject({
      text: 'Start streamed',
    });
  });
  it('does not resurrect messages or parts removed while loading', () => {
    const before = [message('a', 1, 'removed'), message('b', 2, 'removed part')];
    const current = [{ ...before[1]!, parts: [] }];
    expect(mergeHistory(structuredClone(before), before, current)).toEqual(current);
  });
  it('accepts an authoritative snapshot when no events changed the loaded history', () => {
    const before = [message('a', 1, 'old')];
    const snapshot = [message('a', 1, 'updated by server')];
    expect(mergeHistory(snapshot, before, before)).toBe(snapshot);
  });
  it('retains new streamed messages without duplicates', () => {
    const before = [message('a', 1, 'initial')];
    const added = message('b', 2, 'new');
    expect(mergeHistory([...before, structuredClone(added)], before, [...before, added])).toEqual([
      ...before,
      added,
    ]);
  });
  it('keeps fetched parts when only a new message header arrived over SSE', () => {
    const snapshot = [message('a', 1, 'Snapshot text')];
    const header = { ...snapshot[0]!, parts: [] };
    expect(mergeHistory(snapshot, [], [header])[0]!.parts).toEqual(snapshot[0]!.parts);
  });
});
