import { useSyncExternalStore } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { z } from 'zod';
import { APP_VERSION } from '../../shared/protocol';
import { ApiError, http } from './api';
import { isNative } from './native';

export const RELEASE_API = 'https://api.github.com/repos/HVHBIGNAME/OpenCodePocket/releases/latest';
export const RELEASES = 'https://github.com/HVHBIGNAME/OpenCodePocket/releases';
const CACHE_KEY = 'occ.updates';
const SUCCESS_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL = 15 * 60 * 1000;
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseSchema = z.object({
  tag_name: z.string().max(60).regex(versionPattern),
  draft: z.literal(false),
  prerelease: z.literal(false),
  body: z.string().nullable().optional(),
  assets: z.array(
    z.object({ name: z.string(), browser_download_url: z.string(), state: z.string().optional() }),
  ),
});
export type Release = { version: string; url: string; notes: string; android?: string; ios?: string };

export function newerVersion(candidate: string, installed: string) {
  const next = candidate.match(versionPattern)?.slice(1).map(Number);
  const current = installed.match(versionPattern)?.slice(1).map(Number);
  if (!next || !current || ![...next, ...current].every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i]! > current[i]!;
  }
  return false;
}

export function parseRelease(value: unknown): Release {
  const raw = releaseSchema.parse(value);
  const version = raw.tag_name.replace(/^v/, '');
  const download = (suffix: string) => {
    const name = `OpenCodePocket-${version}-${suffix}`;
    const url = `${RELEASES}/download/${raw.tag_name}/${name}`;
    return raw.assets.some(
      (asset) =>
        asset.name === name &&
        asset.browser_download_url === url &&
        (!asset.state || asset.state === 'uploaded'),
    )
      ? url
      : undefined;
  };
  return {
    version,
    url: `${RELEASES}/tag/${raw.tag_name}`,
    notes: (raw.body ?? '').slice(0, 6000),
    android: download('android.apk'),
    ios: download('ios-unsigned.ipa'),
  };
}

type UpdateState = {
  checking: boolean;
  checkedAt?: number;
  release?: Release;
  error?: string;
  dismissed?: string;
};
let current: UpdateState = { checking: false };
let lastAttempt = 0;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();
function publish(patch: Partial<UpdateState>) {
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useUpdates() {
  return useSyncExternalStore(subscribe, () => current);
}
export function updateAvailable(state: UpdateState) {
  return Boolean(state.release && newerVersion(state.release.version, APP_VERSION));
}

export function checkUpdates(force = false): Promise<void> {
  if (pending) return pending;
  const interval = current.error ? RETRY_INTERVAL : SUCCESS_INTERVAL;
  if (!force && Date.now() - lastAttempt < interval) return Promise.resolve();
  lastAttempt = Date.now();
  publish({ checking: true, error: undefined });
  pending = (async () => {
    try {
      const raw = await http<unknown>(RELEASE_API, 'GET', undefined, undefined, undefined, 15000);
      const release = parseRelease(raw);
      publish({ checking: false, release, checkedAt: Date.now() });
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: current.checkedAt, raw }));
      } catch (error) {
        console.warn('Update cache could not be saved', error instanceof Error ? error.name : 'Error');
      }
    } catch (error) {
      publish({
        checking: false,
        error:
          error instanceof ApiError && [403, 429].includes(error.status)
            ? 'GitHub временно ограничил проверки. Повтори позже.'
            : 'Не удалось проверить обновления. Проверь интернет и попробуй ещё раз.',
      });
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

export function dismissUpdate() {
  publish({ dismissed: current.release?.version });
  try {
    localStorage.setItem('occ.updateDismissed', current.release?.version ?? '');
  } catch (error) {
    console.warn('Update dismissal could not be saved', error instanceof Error ? error.name : 'Error');
  }
}

export function installUpdateChecking() {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    const parsed = z
      .object({ checkedAt: z.number().finite().nonnegative(), raw: z.unknown() })
      .safeParse(cached);
    if (parsed.success && parsed.data.checkedAt <= Date.now()) {
      publish({ checkedAt: parsed.data.checkedAt, release: parseRelease(parsed.data.raw) });
      lastAttempt = parsed.data.checkedAt;
    }
    publish({ dismissed: localStorage.getItem('occ.updateDismissed') ?? undefined });
  } catch (error) {
    console.warn('Update cache could not be read', error instanceof Error ? error.name : 'Error');
  }
  const check = () => {
    if (!document.hidden) void checkUpdates();
  };
  check();
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  const timer = setInterval(check, SUCCESS_INTERVAL);
  const native = isNative
    ? NativeApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void checkUpdates();
      })
    : undefined;
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    void native
      ?.then((handle) => handle.remove())
      .catch((error: unknown) =>
        console.warn('Update listener cleanup failed', error instanceof Error ? error.name : 'Error'),
      );
  };
}
