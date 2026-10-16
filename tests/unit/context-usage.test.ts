import { expect, it } from 'vitest';
import { contextUsage } from '../../src/lib/context-usage';
import type { MessageEntry } from '../../src/types';

const entry: MessageEntry = {
  info: {
    role: 'assistant',
    id: 'a',
    sessionID: 's',
    parentID: 'u',
    time: { created: 1 },
    modelID: 'm',
    providerID: 'p',
    mode: 'build',
    agent: 'build',
    path: { cwd: '/', root: '/' },
    cost: 0,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 30 } },
  },
  parts: [],
};
it('includes cache tokens and resolves the actual response model, not a same-named provider model', () => {
  expect(
    contextUsage(
      [entry],
      [
        { id: 'm', name: 'Other', providerID: 'other', limit: { context: 500, output: 100 } },
        { id: 'm', name: 'Actual', providerID: 'p', limit: { context: 1000, output: 100 } },
      ],
    ),
  ).toEqual({ used: 200, limit: 1000, percent: 20, model: 'Actual' });
});
it('does not invent a limit for an unavailable model or usage before an answer', () => {
  expect(contextUsage([entry], [])).toMatchObject({ used: 200, limit: undefined, percent: undefined });
  expect(contextUsage([], [])).toBeUndefined();
});
