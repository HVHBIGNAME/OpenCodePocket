import type { LiveData } from '../store/reducer';
import type { Session } from '../types';

export function sessionActivity(data: Pick<LiveData, 'sessions' | 'statuses' | 'questions' | 'permissions'>) {
  const parents = new Map(data.sessions.map((session) => [session.id, session.parentID]));
  const includeParents = (ids: string[]) => {
    const result = new Set<string>();
    for (let id of ids) {
      while (id && !result.has(id)) {
        result.add(id);
        id = parents.get(id) ?? '';
      }
    }
    return result;
  };
  return {
    waiting: includeParents([...data.questions, ...data.permissions].map((item) => item.sessionID)),
    busy: includeParents(
      Object.entries(data.statuses)
        .filter(([, status]) => status.type !== 'idle')
        .map(([id]) => id),
    ),
  };
}

export function agentSessions(sessions: Session[], parentID: string) {
  const children = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.parentID) continue;
    const siblings = children.get(session.parentID) ?? [];
    siblings.push(session);
    children.set(session.parentID, siblings);
  }
  for (const siblings of children.values())
    siblings.sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id));
  const rows: { session: Session; depth: number }[] = [];
  const visited = new Set([parentID]);
  const stack = (children.get(parentID) ?? [])
    .slice()
    .reverse()
    .map((session) => ({ session, depth: 0 }));
  while (stack.length) {
    const row = stack.pop()!;
    if (visited.has(row.session.id)) continue;
    visited.add(row.session.id);
    rows.push(row);
    for (const session of (children.get(row.session.id) ?? []).slice().reverse())
      stack.push({ session, depth: row.depth + 1 });
  }
  return rows;
}
