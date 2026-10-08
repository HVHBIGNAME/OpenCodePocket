import { describe, expect, it } from 'vitest';
import { applyEvent, emptyData } from '../../src/store/reducer';
import type { Message, Part } from '../../src/types';

describe('live session updates', () => {
  it('normalizes v2 questions and permissions without losing directory context', () => {
    let state = emptyData();
    state = applyEvent(state, {
      type: 'question.v2.asked',
      directory: '/repo',
      properties: { id: 'q', sessionID: 's', questions: [] },
    });
    state = applyEvent(state, {
      type: 'permission.v2.asked',
      directory: '/repo',
      properties: { id: 'p', sessionID: 's', action: 'bash', resources: ['npm test'] },
    });
    expect(state.questions[0]?.directory).toBe('/repo');
    expect(state.permissions[0]).toMatchObject({
      permission: 'bash',
      patterns: ['npm test'],
      directory: '/repo',
    });
    state = applyEvent(state, { type: 'question.v2.replied', properties: { requestID: 'q' } });
    expect(state.questions).toHaveLength(0);
  });
  it('applies part deltas only to the correct loaded message and preserves other parts', () => {
    const info: Message = {
      id: 'm',
      sessionID: 's',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { providerID: 'p', modelID: 'm' },
    };
    const part: Part = { id: 'p', messageID: 'm', sessionID: 's', type: 'text', text: 'Hello ' };
    let state = { ...emptyData(), messages: { s: [{ info, parts: [part] }] } };
    state = applyEvent(state, {
      type: 'message.part.delta',
      properties: { sessionID: 's', messageID: 'm', partID: 'p', field: 'text', delta: 'world' },
    }) as typeof state;
    expect(state.messages.s[0]?.parts[0]).toMatchObject({ text: 'Hello world' });
    state = applyEvent(state, {
      type: 'message.part.removed',
      properties: { sessionID: 's', messageID: 'm', partID: 'p' },
    }) as typeof state;
    expect(state.messages.s[0]?.parts).toHaveLength(0);
  });
});
