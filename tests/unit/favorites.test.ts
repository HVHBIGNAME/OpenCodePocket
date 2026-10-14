import { describe, expect, it } from 'vitest';
import { FavoritesStore } from '../../src/store/favorites';

describe('saved favorites', () => {
  it('serializes rapid toggles, restores them and keeps computers separate', async () => {
    const values = new Map<string, unknown>();
    const io = {
      read: async (key: string) => values.get(key),
      write: async (key: string, value: unknown) => {
        values.set(key, value);
      },
      remove: async (key: string) => {
        values.delete(key);
      },
    };
    const store = new FavoritesStore(io);
    await Promise.all([
      store.toggle('a', 'one'),
      store.toggle('a', 'two'),
      store.toggle('a', 'one'),
      store.toggle('b', 'one'),
    ]);
    const restored = new FavoritesStore(io);
    await Promise.all([restored.load('a'), restored.load('b')]);
    expect([...restored.get('a').ids]).toEqual(['two']);
    expect([...restored.get('b').ids]).toEqual(['one']);
    await restored.remove('a');
    expect(values.has('occ.favorites.a')).toBe(false);
    expect([...restored.get('b').ids]).toEqual(['one']);
  });
  it('does not report failed writes as saved and recovers on the next change', async () => {
    let fail = true;
    const store = new FavoritesStore({
      read: async () => ['saved', null, 42],
      write: async () => {
        if (fail) throw new Error('locked');
      },
      remove: async () => undefined,
    });
    await expect(store.toggle('a', 'new')).rejects.toThrow('locked');
    expect([...store.get('a').ids]).toEqual(['saved']);
    fail = false;
    await store.toggle('a', 'new');
    expect([...store.get('a').ids]).toEqual(['saved', 'new']);
  });
});
