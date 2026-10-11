import type { LiveData } from '../store/reducer';
import type { MessageEntry, Session } from '../types';

export type SessionFilters = {
  search: string;
  filter: 'all' | 'busy' | 'waiting' | 'archived';
  project: string;
  children: boolean;
};
export const defaultSessionFilters: SessionFilters = {
  search: '',
  filter: 'all',
  project: '',
  children: false,
};

export function matchesSearch(text: string, query: string) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  return query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .every((term) => normalized.includes(term));
}

export function filterSessions(
  data: Pick<LiveData, 'sessions' | 'statuses' | 'questions' | 'permissions'>,
  filters: SessionFilters,
) {
  const waiting = new Set([...data.questions, ...data.permissions].map((item) => item.sessionID));
  return data.sessions
    .filter((item) => {
      if (Boolean(item.time.archived) !== (filters.filter === 'archived')) return false;
      if (item.parentID && !filters.children) return false;
      if (filters.project && item.directory !== filters.project) return false;
      if (!matchesSearch(`${item.title} ${item.directory}`, filters.search)) return false;
      if (filters.filter === 'busy') return ['busy', 'retry'].includes(data.statuses[item.id]?.type ?? '');
      if (filters.filter === 'waiting') return waiting.has(item.id);
      return true;
    })
    .sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id));
}

export function groupSessions(sessions: Session[]) {
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const group = groups.get(session.directory) ?? [];
    group.push(session);
    groups.set(session.directory, group);
  }
  return [...groups.entries()];
}

export function stableSessionOrder(sessions: Session[], previous: string[]): Session[] {
  const remaining = new Map(sessions.map((session) => [session.id, session]));
  const ordered: Session[] = [];
  for (const id of previous) {
    const session = remaining.get(id);
    if (session) {
      ordered.push(session);
      remaining.delete(id);
    }
  }
  return [
    ...ordered,
    ...[...remaining.values()].sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id)),
  ];
}

export function messageSearchText(entry: MessageEntry) {
  return entry.parts
    .flatMap((part) => {
      if (part.type === 'text') return part.ignored ? [] : [part.text];
      if (part.type === 'reasoning') return [part.text];
      if (part.type === 'file') return [part.filename ?? ''];
      if (part.type === 'tool')
        return [
          part.tool,
          JSON.stringify(part.state.input),
          'output' in part.state ? part.state.output : '',
          'error' in part.state ? part.state.error : '',
        ];
      return [];
    })
    .join('\n');
}
