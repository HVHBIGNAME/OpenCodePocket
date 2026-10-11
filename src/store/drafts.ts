import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Attachment } from '../lib/attachments';
import { vaultRead, vaultWrite } from '../lib/native';

export type ComposerDraft = {
  text: string;
  attachments: Attachment[];
  loaded: boolean;
  sending: boolean;
  preparing: boolean;
};
const emptyDraft: ComposerDraft = {
  text: '',
  attachments: [],
  loaded: false,
  sending: false,
  preparing: false,
};

export class DraftStore {
  private drafts = new Map<string, ComposerDraft>();
  private listeners = new Set<() => void>();
  private loading = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private writes = new Map<string, Promise<void>>();

  constructor(private report: (error: unknown) => void) {}

  get = (key: string) => this.drafts.get(key) ?? emptyDraft;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(key: string, patch: Partial<ComposerDraft>) {
    this.drafts.set(key, { ...this.get(key), ...patch });
    for (const listener of this.listeners) listener();
    if (patch.text !== undefined) {
      clearTimeout(this.timers.get(key));
      this.timers.set(
        key,
        setTimeout(() => {
          void this.flush(key);
        }, 450),
      );
    }
  }

  load(key: string): Promise<void> {
    if (this.get(key).loaded) return Promise.resolve();
    const existing = this.loading.get(key);
    if (existing) return existing;
    const operation = vaultRead<string>(key)
      .then((text) => {
        this.update(key, { text: typeof text === 'string' ? text : '', loaded: true });
      })
      .catch((error: unknown) => {
        this.update(key, { loaded: true });
        this.report(error);
      })
      .finally(() => {
        this.loading.delete(key);
      });
    this.loading.set(key, operation);
    return operation;
  }

  flush(key: string): Promise<void> {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const draft = this.get(key);
    if (!draft.loaded) return Promise.resolve();
    const write = (this.writes.get(key) ?? Promise.resolve())
      .then(() => vaultWrite(key, draft.text))
      .catch(this.report)
      .finally(() => {
        if (this.writes.get(key) === write) this.writes.delete(key);
      });
    this.writes.set(key, write);
    return write;
  }

  flushAll() {
    return Promise.all([...this.timers.keys()].map((key) => this.flush(key)));
  }
}

export function useComposerDraft(store: DraftStore, key: string) {
  const getSnapshot = useCallback(() => store.get(key), [store, key]);
  const draft = useSyncExternalStore(store.subscribe, getSnapshot);
  useEffect(() => {
    void store.load(key);
    return () => {
      void store.flush(key);
    };
  }, [store, key]);
  return draft;
}
