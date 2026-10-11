import type { ServerEvent } from '../../shared/protocol';
import type { Message, MessageEntry, Part } from '../types';
import type { LiveData } from './reducer';
import { mergeHistory } from './history';

function target(event: ServerEvent) {
  const p = event.properties;
  const info = p.info as Message | undefined;
  const part = p.part as Part | undefined;
  return {
    session: (p.sessionID ?? info?.sessionID ?? part?.sessionID) as string | undefined,
    message: (p.messageID ?? info?.id ?? part?.messageID) as string | undefined,
    part: (p.partID ?? part?.id) as string | undefined,
  };
}

function update(entries: MessageEntry[], event: ServerEvent): MessageEntry[] | undefined {
  const p = event.properties;
  const ids = target(event);
  const entry = entries.find((item) => item.info.id === ids.message);
  if (event.type === 'message.updated') {
    const info = p.info as Message | undefined;
    if (!info?.id || !info.sessionID) return entries;
    return entry
      ? entries.map((item) => (item === entry ? { ...item, info } : item))
      : [...entries, { info, parts: [] }].sort(
          (a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id),
        );
  }
  if (event.type === 'message.removed') return entries.filter((item) => item.info.id !== ids.message);
  if (!entry) return undefined;
  const part = p.part as Part | undefined;
  if (event.type === 'message.part.updated' && part?.id) {
    const exists = entry.parts.some((item) => item.id === part.id);
    return entries.map((item) =>
      item === entry
        ? {
            ...item,
            parts: exists
              ? item.parts.map((value) => (value.id === part.id ? part : value))
              : [...item.parts, part],
          }
        : item,
    );
  }
  if (event.type === 'message.part.removed')
    return entries.map((item) =>
      item === entry ? { ...item, parts: item.parts.filter((value) => value.id !== ids.part) } : item,
    );
  if (event.type === 'message.part.delta' && p.field === 'text' && typeof p.delta === 'string') {
    const value = entry.parts.find((item) => item.id === ids.part);
    if (!value) return undefined;
    if (value.type !== 'text' && value.type !== 'reasoning') return entries;
    const updated = { ...value, text: value.text + p.delta };
    return entries.map((item) =>
      item === entry ? { ...item, parts: item.parts.map((part) => (part === value ? updated : part)) } : item,
    );
  }
  return entries;
}

export function applyMessageEvent(state: LiveData, event: ServerEvent): LiveData {
  const ids = target(event);
  if (!ids.session || !ids.message || !state.messages[ids.session]) return state;
  const id = ids.session;
  let entries = state.messages[id]!;
  let pending = state.pendingMessages[id] ?? [];
  if (event.type === 'message.removed' || event.type === 'message.part.removed')
    pending = pending.filter((item) => {
      const other = target(item);
      return (
        other.message !== ids.message || (event.type === 'message.part.removed' && other.part !== ids.part)
      );
    });
  const next = update(entries, event);
  if (!next) pending = [...pending, event];
  else entries = next;
  // Parts may precede their message header, and text deltas may precede a part.
  // Drain only after the missing base exists, retaining the received order.
  let progressed = true;
  while (progressed && pending.length) {
    progressed = false;
    const remaining: ServerEvent[] = [];
    for (const item of pending) {
      const result = update(entries, item);
      if (result) {
        entries = result;
        progressed = true;
      } else remaining.push(item);
    }
    pending = remaining;
  }
  const overflow = pending.length > 128 || JSON.stringify(pending).length > 262144;
  return {
    ...state,
    messages: entries === state.messages[id] ? state.messages : { ...state.messages, [id]: entries },
    pendingMessages: { ...state.pendingMessages, [id]: overflow ? [] : pending },
    needsHistory: overflow ? { ...state.needsHistory, [id]: true } : state.needsHistory,
  };
}

export function reconcileMessages(
  state: LiveData,
  id: string,
  snapshot: MessageEntry[],
  before: MessageEntry[],
  pendingBefore: ServerEvent[] | undefined,
): LiveData {
  return {
    ...state,
    messages: { ...state.messages, [id]: mergeHistory(snapshot, before, state.messages[id] ?? []) },
    pendingMessages: { ...state.pendingMessages, [id]: [] },
    // An orphan arriving after the request began may be newer than its snapshot.
    // Fetch once more rather than appending deltas that the snapshot may already include.
    needsHistory: {
      ...state.needsHistory,
      [id]: Boolean(
        state.needsHistory[id] ||
        (state.pendingMessages[id]?.length && state.pendingMessages[id] !== pendingBefore),
      ),
    },
  };
}
