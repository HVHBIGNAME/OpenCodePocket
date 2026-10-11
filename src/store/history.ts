import type { MessageEntry } from '../types';

export function mergeSnapshot<T extends { id: string }>(snapshot: T[], before: T[], current: T[]): T[] {
  const baseline = new Map(before.map((item) => [item.id, item]));
  const live = new Map(current.map((item) => [item.id, item]));
  const result = new Map(snapshot.map((item) => [item.id, item]));
  for (const id of baseline.keys()) if (!live.has(id)) result.delete(id);
  for (const [id, item] of live) if (item !== baseline.get(id)) result.set(id, item);
  return [...result.values()];
}

// HTTP snapshots can arrive after newer SSE updates. Only overlay entries and
// parts that actually changed while the snapshot was in flight.
export function mergeHistory(
  snapshot: MessageEntry[],
  before: MessageEntry[],
  current: MessageEntry[],
): MessageEntry[] {
  if (before === current) return snapshot;
  const baseline = new Map(before.map((entry) => [entry.info.id, entry]));
  const live = new Map(current.map((entry) => [entry.info.id, entry]));
  const result = new Map(snapshot.map((entry) => [entry.info.id, entry]));
  for (const id of baseline.keys()) if (!live.has(id)) result.delete(id);
  for (const [id, entry] of live) {
    const original = baseline.get(id);
    if (entry === original) continue;
    const fetched = result.get(id);
    if (!fetched) {
      result.set(id, entry);
      continue;
    }
    const oldParts = new Map((original?.parts ?? []).map((part) => [part.id, part]));
    const newParts = new Map(entry.parts.map((part) => [part.id, part]));
    const parts = new Map(fetched.parts.map((part) => [part.id, part]));
    for (const partID of oldParts.keys()) if (!newParts.has(partID)) parts.delete(partID);
    for (const [partID, part] of newParts) if (part !== oldParts.get(partID)) parts.set(partID, part);
    result.set(id, {
      info: entry.info !== original?.info ? entry.info : fetched.info,
      parts: [...parts.values()],
    });
  }
  return [...result.values()].sort(
    (a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id),
  );
}
