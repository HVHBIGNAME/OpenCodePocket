import type { ServerEvent } from '../../shared/protocol';
import type {
  MessageEntry,
  Session,
  SessionStatus,
  PendingQuestion,
  PendingPermission,
  Part,
  Message,
  Todo,
  SnapshotFileDiff,
} from '../types';

export type LiveData = {
  sessions: Session[];
  statuses: Record<string, SessionStatus>;
  questions: PendingQuestion[];
  permissions: PendingPermission[];
  messages: Record<string, MessageEntry[]>;
  todos: Record<string, Todo[]>;
  diffs: Record<string, SnapshotFileDiff[]>;
};
export const emptyData = (): LiveData => ({
  sessions: [],
  statuses: {},
  questions: [],
  permissions: [],
  messages: {},
  todos: {},
  diffs: {},
});
function upsert<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  return items.map((item, i) => (i === index ? value : item));
}

export function applyEvent(state: LiveData, event: ServerEvent): LiveData {
  const p = event.properties;
  const sessionID = typeof p.sessionID === 'string' ? p.sessionID : undefined;
  if (event.type === 'todo.updated' && sessionID && Array.isArray(p.todos))
    return { ...state, todos: { ...state.todos, [sessionID]: p.todos as Todo[] } };
  if (event.type === 'session.diff' && sessionID && Array.isArray(p.diff))
    return { ...state, diffs: { ...state.diffs, [sessionID]: p.diff as SnapshotFileDiff[] } };
  if ((event.type === 'session.created' || event.type === 'session.updated') && p.info) {
    const session = p.info as Session;
    if (!session.id) return state;
    return { ...state, sessions: upsert(state.sessions, session) };
  }
  if (event.type === 'session.deleted') {
    const id = (p.info as Session | undefined)?.id ?? sessionID;
    if (!id) return state;
    const removed = new Set([id]);
    let size = 0;
    while (size !== removed.size) {
      size = removed.size;
      for (const session of state.sessions)
        if (session.parentID && removed.has(session.parentID)) removed.add(session.id);
    }
    return {
      ...state,
      sessions: state.sessions.filter((session) => !removed.has(session.id)),
      messages: Object.fromEntries(Object.entries(state.messages).filter(([key]) => !removed.has(key))),
      todos: Object.fromEntries(Object.entries(state.todos).filter(([key]) => !removed.has(key))),
      diffs: Object.fromEntries(Object.entries(state.diffs).filter(([key]) => !removed.has(key))),
      statuses: Object.fromEntries(Object.entries(state.statuses).filter(([key]) => !removed.has(key))),
      questions: state.questions.filter((item) => !removed.has(item.sessionID)),
      permissions: state.permissions.filter((item) => !removed.has(item.sessionID)),
    };
  }
  if (event.type === 'session.status' && sessionID && p.status)
    return { ...state, statuses: { ...state.statuses, [sessionID]: p.status as SessionStatus } };
  if (event.type === 'session.idle' && sessionID)
    return { ...state, statuses: { ...state.statuses, [sessionID]: { type: 'idle' } } };
  if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
    if (typeof p.id !== 'string' || !Array.isArray(p.questions) || !sessionID) return state;
    return {
      ...state,
      questions: upsert(state.questions, { ...p, directory: event.directory } as PendingQuestion),
    };
  }
  if (event.type === 'permission.asked' || event.type === 'permission.v2.asked') {
    if (typeof p.id !== 'string' || !sessionID) return state;
    const permission = {
      ...p,
      permission: p.permission ?? p.action,
      patterns: p.patterns ?? p.resources ?? [],
      always: p.always ?? p.save ?? [],
      metadata: p.metadata ?? {},
      directory: event.directory,
    } as PendingPermission;
    return { ...state, permissions: upsert(state.permissions, permission) };
  }
  if (/^question\.(v2\.)?(replied|rejected)$/.test(event.type))
    return { ...state, questions: state.questions.filter((item) => item.id !== p.requestID) };
  if (/^permission\.(v2\.)?replied$/.test(event.type))
    return { ...state, permissions: state.permissions.filter((item) => item.id !== p.requestID) };
  if (event.type === 'message.updated' && p.info) {
    const info = p.info as Message;
    const messages = state.messages[info.sessionID];
    if (!messages) return state;
    const entry = messages.find((item) => item.info.id === info.id);
    return {
      ...state,
      messages: {
        ...state.messages,
        [info.sessionID]: entry
          ? messages.map((item) => (item === entry ? { ...item, info } : item))
          : [...messages, { info, parts: [] }],
      },
    };
  }
  const part = p.part as Part | undefined;
  const id = sessionID ?? part?.sessionID;
  if (!id || !state.messages[id]) return state;
  const entries = state.messages[id]!;
  if (event.type === 'message.removed')
    return {
      ...state,
      messages: { ...state.messages, [id]: entries.filter((item) => item.info.id !== p.messageID) },
    };
  if (event.type === 'message.part.updated' && part) {
    return {
      ...state,
      messages: {
        ...state.messages,
        [id]: entries.map((item) =>
          item.info.id === part.messageID ? { ...item, parts: upsert(item.parts, part) } : item,
        ),
      },
    };
  }
  if (event.type === 'message.part.delta' && p.field === 'text' && typeof p.delta === 'string') {
    return {
      ...state,
      messages: {
        ...state.messages,
        [id]: entries.map((item) =>
          item.info.id !== p.messageID
            ? item
            : {
                ...item,
                parts: item.parts.map((value) =>
                  value.id === p.partID && (value.type === 'text' || value.type === 'reasoning')
                    ? { ...value, text: value.text + p.delta }
                    : value,
                ),
              },
        ),
      },
    };
  }
  if (event.type === 'message.part.removed')
    return {
      ...state,
      messages: {
        ...state.messages,
        [id]: entries.map((item) => ({
          ...item,
          parts: item.parts.filter((value) => value.id !== p.partID),
        })),
      },
    };
  return state;
}
