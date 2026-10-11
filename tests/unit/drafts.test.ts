import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { read, write } = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../src/lib/native', () => ({ vaultRead: read, vaultWrite: write }));
import { DraftStore } from '../../src/store/drafts';

beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset().mockResolvedValue(undefined);
  write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('session draft lifetime', () => {
  it('does not overwrite storage when leaving before the initial read completes', async () => {
    let resolve!: (text: string) => void;
    read.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const store = new DraftStore(vi.fn());
    const loading = store.load('session');
    await store.flush('session');
    expect(write).not.toHaveBeenCalled();
    resolve('saved draft');
    await loading;
    expect(store.get('session').text).toBe('saved draft');
    await store.flushAll();
  });
  it('preserves attachments and in-flight send state across subscribers, isolated by connection', async () => {
    const store = new DraftStore(vi.fn());
    await store.load('server-a.session');
    const attachments = [
      {
        type: 'file' as const,
        filename: 'photo.jpg',
        mime: 'image/jpeg',
        url: 'data:image/jpeg;base64,AA==',
        bytes: 1,
      },
    ];
    const unsubscribe = store.subscribe(vi.fn());
    store.update('server-a.session', { text: 'draft', attachments, sending: true });
    unsubscribe();
    expect(store.get('server-a.session')).toMatchObject({ attachments, sending: true, text: 'draft' });
    expect(store.get('server-b.session').attachments).toEqual([]);
    store.update('server-a.session', { text: '', attachments: [], sending: false });
    await store.flush('server-a.session');
    expect(write).toHaveBeenLastCalledWith('server-a.session', '');
  });
  it('keeps input usable and reports a vault read failure', async () => {
    read.mockRejectedValue(new Error('vault unavailable'));
    const report = vi.fn();
    const store = new DraftStore(report);
    await store.load('s');
    expect(store.get('s').loaded).toBe(true);
    expect(report).toHaveBeenCalledOnce();
  });
  it('coalesces typing and writes text only, never attachment data', async () => {
    const store = new DraftStore(vi.fn());
    await store.load('s');
    store.update('s', { text: 'one' });
    store.update('s', { text: 'two' });
    await vi.advanceTimersByTimeAsync(450);
    expect(write.mock.calls).toEqual([['s', 'two']]);
  });
});
