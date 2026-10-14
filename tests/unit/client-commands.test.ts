import { describe, expect, it, vi } from 'vitest';
import { commandCatalog, commandSuggestions, runSessionCommand } from '../../src/lib/commands';
import { groupModels } from '../../src/lib/model-groups';
import { OpenCodeClient } from '../../src/lib/api';
import type { MessageEntry, Session } from '../../src/types';

const session: Session = {
  id: 'ses_test',
  title: 'Test',
  directory: '/work/project',
  slug: 'test',
  projectID: 'p',
  version: '1',
  time: { created: 1, updated: 1 },
};
const entries: MessageEntry[] = ['msg_001', 'msg_002', 'msg_003'].map((id) => ({
  info: {
    id,
    sessionID: session.id,
    role: 'user',
    time: { created: 1 },
    agent: 'build',
    model: { providerID: 'p', modelID: 'm' },
  },
  parts: [],
}));

describe('OpenCode client command and model selection', () => {
  it('combines builtins and server commands and completes names without interpreting arguments', () => {
    const catalog = commandCatalog([
      { name: 'review', description: 'Review', template: '$ARGUMENTS', hints: [] },
      { name: 'compact', template: 'must not replace the built-in', hints: [] },
    ]);
    expect(catalog.filter((item) => item.name === 'compact')).toHaveLength(1);
    expect(commandSuggestions(catalog, '/com').map((item) => item.name)).toEqual(['compact']);
    expect(commandSuggestions(catalog, '/REVIEW').map((item) => item.name)).toEqual(['review']);
    for (const draft of ['normal /review', '/review args', '/compact\n'])
      expect(commandSuggestions(catalog, draft)).toEqual([]);
  });
  it('uses summarize with the selected provider/model, and steps undo/redo through messages', async () => {
    const client = new OpenCodeClient({
      id: 'pc',
      name: 'test',
      url: 'http://localhost:4141',
      mode: 'bridge',
      credential: 'fixture',
    });
    const request = vi.spyOn(client, 'request').mockResolvedValue(session);
    await runSessionCommand('compact', client, session, entries, {
      providerID: 'chosen',
      modelID: 'selected',
    });
    expect(request).toHaveBeenLastCalledWith(
      '/session/ses_test/summarize',
      expect.objectContaining({
        directory: '/work/project',
        method: 'POST',
        data: { providerID: 'chosen', modelID: 'selected', auto: false },
      }),
    );
    await runSessionCommand('undo', client, { ...session, revert: { messageID: 'msg_003' } }, entries);
    expect(request).toHaveBeenLastCalledWith(
      '/session/ses_test/revert',
      expect.objectContaining({ data: { messageID: 'msg_002' } }),
    );
    await runSessionCommand('redo', client, { ...session, revert: { messageID: 'msg_002' } }, entries);
    expect(request).toHaveBeenLastCalledWith(
      '/session/ses_test/revert',
      expect.objectContaining({ data: { messageID: 'msg_003' } }),
    );
    await runSessionCommand('redo', client, { ...session, revert: { messageID: 'msg_003' } }, entries);
    expect(request).toHaveBeenLastCalledWith(
      '/session/ses_test/unrevert',
      expect.objectContaining({ method: 'POST' }),
    );
    await expect(runSessionCommand('redo', client, session, entries)).rejects.toThrow('Нет отменённых');
  });
  it('keeps identically named models in their providers, ordered like the upstream selector', () => {
    const models = [
      { id: 'same', name: 'Same', providerID: 'other', providerName: 'Zulu' },
      { id: 'same', name: 'Same', providerID: 'anthropic', providerName: 'Anthropic' },
      {
        id: 'free',
        name: 'Free',
        providerID: 'opencode',
        providerName: 'OpenCode',
        cost: { input: 0, output: 0 },
      },
      { id: 'old', name: 'Old', providerID: 'opencode', providerName: 'OpenCode', status: 'deprecated' },
    ];
    expect(groupModels(models, '').map((group) => group.id)).toEqual(['opencode', 'anthropic', 'other']);
    expect(groupModels(models, 'same')).toHaveLength(2);
    expect(groupModels(models, 'Anthropic Same')[0]?.models[0]?.providerID).toBe('anthropic');
    expect(groupModels(models, 'Old')).toEqual([]);
  });
});
