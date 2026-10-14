import { afterEach, describe, expect, it, vi } from 'vitest';
import { newerVersion, parseRelease, RELEASES } from '../../src/lib/updates';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/native', () => ({ isNative: false }));
vi.mock('../../src/lib/api', () => ({
  http: request,
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  request.mockReset();
});
const stable = { tag_name: 'v1.10.0', draft: false, prerelease: false, body: 'Notes', assets: [] };

describe('release checks', () => {
  it('compares numeric versions and rejects unstable or malformed versions', () => {
    expect(newerVersion('v1.10.0', '1.9.9')).toBe(true);
    expect(newerVersion('1.0.6', '1.0.6')).toBe(false);
    expect(newerVersion('1.0.5', '1.0.6')).toBe(false);
    for (const version of ['1.0.7-beta.1', 'latest', '999999999999999999999.0.0', '1.00.6'])
      expect(newerVersion(version, '1.0.6')).toBe(false);
    expect(() => parseRelease({ ...stable, prerelease: true })).toThrow();
    expect(() => parseRelease({ ...stable, draft: true })).toThrow();
  });
  it('only links uploaded, version-matched assets from this repository', () => {
    const name = 'OpenCodePocket-1.10.0-android.apk';
    const url = `${RELEASES}/download/v1.10.0/${name}`;
    expect(
      parseRelease({ ...stable, assets: [{ name, browser_download_url: url, state: 'uploaded' }] }).android,
    ).toBe(url);
    for (const invalid of [
      { name, browser_download_url: 'https://example.org/app.apk' },
      { name, browser_download_url: url, state: 'starter' },
    ])
      expect(parseRelease({ ...stable, assets: [invalid] }).android).toBeUndefined();
  });
  it('deduplicates checks, throttles automatic refresh and allows manual recovery', async () => {
    vi.stubGlobal('localStorage', { setItem: vi.fn() });
    const { checkUpdates } = await import('../../src/lib/updates');
    let release!: (value: unknown) => void;
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = checkUpdates(true);
    expect(checkUpdates(true)).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
    release(stable);
    await first;
    await checkUpdates();
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new Error('offline'));
    await checkUpdates(true);
    await checkUpdates();
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValueOnce(stable);
    await checkUpdates(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every((args) => args[3] === undefined)).toBe(true);
  });
});
