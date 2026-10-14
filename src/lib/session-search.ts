import type { LiveData } from '../store/reducer';
import type { MessageEntry, Session } from '../types';
import { sessionActivity } from './session-tree';

export type SessionFilters = {
  search: string;
  filter: 'all' | 'busy' | 'waiting' | 'archived';
  project: string;
  favoritesOnly: boolean;
};
export const defaultSessionFilters: SessionFilters = {
  search: '',
  filter: 'all',
  project: '',
  favoritesOnly: false,
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
  favorites: ReadonlySet<string> = new Set(),
) {
  const { waiting, busy } = sessionActivity(data);
  return data.sessions
    .filter((item) => {
      if (Boolean(item.time.archived) !== (filters.filter === 'archived')) return false;
      if (item.parentID) return false;
      if (filters.favoritesOnly && !favorites.has(item.id)) return false;
      if (filters.project && item.directory !== filters.project) return false;
      if (!matchesSearch(`${item.title} ${item.directory}`, filters.search)) return false;
      if (filters.filter === 'busy') return busy.has(item.id);
      if (filters.filter === 'waiting') return waiting.has(item.id);
      return true;
    })
    .sort((a, b) => b.time.updated - a.time.updated || a.id.localeCompare(b.id));
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
