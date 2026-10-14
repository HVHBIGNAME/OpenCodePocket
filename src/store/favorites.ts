import { useEffect, useSyncExternalStore } from 'react';
import { vaultRead, vaultRemove, vaultWrite } from '../lib/native';

type Snapshot = { ids: ReadonlySet<string>; loaded: boolean };
const empty: Snapshot = { ids: new Set(), loaded: false };
const storage = { read: vaultRead<unknown>, write: vaultWrite, remove: vaultRemove };

export class FavoritesStore {
  private snapshots = new Map<string, Snapshot>();
  private loading = new Map<string, Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();

  constructor(private io = storage) {}

  get = (connectionID: string) => this.snapshots.get(connectionID) ?? empty;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(connectionID: string, ids: ReadonlySet<string>) {
    this.snapshots.set(connectionID, { ids, loaded: true });
    for (const listener of this.listeners) listener();
  }

  async load(connectionID: string) {
    if (this.get(connectionID).loaded) return;
    const pending = this.loading.get(connectionID);
    if (pending) return pending;
    const task = this.io.read(`occ.favorites.${connectionID}`).then((value) => {
      const ids = Array.isArray(value)
        ? value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
        : [];
      this.publish(connectionID, new Set(ids));
    });
    this.loading.set(connectionID, task);
    try {
      await task;
    } finally {
      this.loading.delete(connectionID);
    }
  }

  private enqueue(connectionID: string, operation: () => Promise<void>) {
    const previous = this.writes.get(connectionID) ?? Promise.resolve();
    const task = previous.then(operation, operation);
    this.writes.set(connectionID, task);
    return task.finally(() => {
      if (this.writes.get(connectionID) === task) this.writes.delete(connectionID);
    });
  }

  toggle(connectionID: string, sessionID: string) {
    return this.enqueue(connectionID, async () => {
      await this.load(connectionID);
      const ids = new Set(this.get(connectionID).ids);
      if (ids.has(sessionID)) ids.delete(sessionID);
      else ids.add(sessionID);
      await this.io.write(`occ.favorites.${connectionID}`, [...ids]);
      this.publish(connectionID, ids);
    });
  }

  remove(connectionID: string) {
    return this.enqueue(connectionID, async () => {
      await this.loading.get(connectionID);
      await this.io.remove(`occ.favorites.${connectionID}`);
      this.snapshots.delete(connectionID);
      for (const listener of this.listeners) listener();
    });
  }
}

export function useFavorites(
  store: FavoritesStore,
  connectionID: string | undefined,
  onError: (error: unknown) => void,
) {
  useEffect(() => {
    if (connectionID) void store.load(connectionID).catch(onError);
  }, [store, connectionID, onError]);
  return useSyncExternalStore(store.subscribe, () => store.get(connectionID ?? ''));
}
