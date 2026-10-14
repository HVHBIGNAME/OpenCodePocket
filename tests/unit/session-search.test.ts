import { describe, expect, it } from 'vitest';
import {
  defaultSessionFilters,
  filterSessions,
  matchesSearch,
  stableSessionOrder,
} from '../../src/lib/session-search';
import { applyEvent, emptyData } from '../../src/store/reducer';
import type { Session } from '../../src/types';
import { agentSessions, sessionActivity } from '../../src/lib/session-tree';

function session(id: string, directory: string, archived = 0, parentID?: string): Session {
  return {
    id,
    directory,
    title: `Название ${id}`,
    parentID,
    time: { created: 1, updated: 2, archived },
    projectID: 'p',
    slug: id,
    version: '1',
  };
}
const sessions = [
  session('root', '/work/a'),
  session('child', '/work/a', 0, 'root'),
  session('archived', '/work/a', 3),
  session('other', '/work/b'),
];

describe('session organisation', () => {
  it('keeps existing rows in place on updates and appends new sessions deterministically', () => {
    const previous = ['other', 'root', 'removed'];
    const updated = sessions.map((item) =>
      item.id === 'root' ? { ...item, time: { ...item.time, updated: 999 } } : item,
    );
    expect(stableSessionOrder(updated, previous).map((item) => item.id)).toEqual([
      'other',
      'root',
      'archived',
      'child',
    ]);
    expect(previous).toEqual(['other', 'root', 'removed']);
    expect(stableSessionOrder([], previous)).toEqual([]);
  });
  it('matches every word regardless of order, case and extra spaces', () => {
    expect(matchesSearch('Панель управления /work/project', ' PROJECT  панель ')).toBe(true);
    expect(matchesSearch('Панель управления', 'панель отсутствует')).toBe(false);
    expect(matchesSearch('text', '   ')).toBe(true);
  });
  it('separates roots, subtasks, archives and directories without mutating the source', () => {
    const data = { ...emptyData(), sessions };
    expect(filterSessions(data, defaultSessionFilters).map((item) => item.id)).toEqual(['other', 'root']);
    expect(
      filterSessions(data, { ...defaultSessionFilters, project: '/work/a' }).map((item) => item.id),
    ).toEqual(['root']);
    expect(
      filterSessions(data, { ...defaultSessionFilters, filter: 'archived' }).map((item) => item.id),
    ).toEqual(['archived']);
    expect(sessions.map((item) => item.id)).toEqual(['root', 'child', 'archived', 'other']);
  });
  it('keeps favorites root-only and surfaces nested requests and work on the parent', () => {
    const data = {
      ...emptyData(),
      sessions: [...sessions, session('grandchild', '/work/a', 0, 'child')],
      statuses: { grandchild: { type: 'busy' as const } },
      questions: [{ id: 'q', sessionID: 'grandchild', questions: [] }],
    };
    const favorites = new Set(['root', 'child']);
    for (const filter of ['all', 'busy', 'waiting'] as const) {
      expect(
        filterSessions(data, { ...defaultSessionFilters, filter, favoritesOnly: true }, favorites).map(
          (item) => item.id,
        ),
      ).toEqual(['root']);
    }
    expect(filterSessions(data, { ...defaultSessionFilters, search: 'child' })).toEqual([]);
    expect(agentSessions(data.sessions, 'root').map(({ session, depth }) => [session.id, depth])).toEqual([
      ['child', 0],
      ['grandchild', 1],
    ]);
    const cyclic = {
      ...data,
      sessions: data.sessions.map((item) =>
        item.id === 'root' ? { ...item, parentID: 'grandchild' } : item,
      ),
    };
    expect(agentSessions(cyclic.sessions, 'root')).toHaveLength(2);
    expect(sessionActivity(cyclic).waiting).toEqual(new Set(['root', 'child', 'grandchild']));
  });
  it('removes descendants, cached messages, statuses and pending requests when a session is deleted', () => {
    const data = {
      ...emptyData(),
      sessions,
      messages: { root: [], child: [], other: [] },
      statuses: { child: { type: 'busy' as const } },
      questions: [{ id: 'q', sessionID: 'child', questions: [] }],
    };
    const result = applyEvent(data, { type: 'session.deleted', properties: { info: { id: 'root' } } });
    expect(result.sessions.map((item) => item.id)).toEqual(['archived', 'other']);
    expect(result.messages).toEqual({ other: [] });
    expect(result.statuses).toEqual({});
    expect(result.questions).toEqual([]);
  });
});
