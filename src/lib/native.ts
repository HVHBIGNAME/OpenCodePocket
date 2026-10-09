import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type NativeEvent = { data: string };
type NativeConnection = { state: 'connected' | 'reconnecting'; message?: string };
type SpeechEvent = { text?: string; final?: boolean; error?: string };

interface PocketNativePlugin {
  readSecure(options: { key: string }): Promise<{ value?: string }>;
  writeSecure(options: { key: string; value: string }): Promise<void>;
  removeSecure(options: { key: string }): Promise<void>;
  startEvents(options: {
    url: string;
    authorization: string;
    notifications: boolean;
    name: string;
  }): Promise<void>;
  stopEvents(): Promise<void>;
  startSpeech(options: { locale: string; offline: boolean }): Promise<void>;
  stopSpeech(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  notificationStatus(): Promise<{ status: 'granted' | 'denied' | 'prompt' }>;
  openNotificationSettings(): Promise<void>;
  registerPush(): Promise<{ token: string }>;
  addListener(name: 'serverEvent', listener: (event: NativeEvent) => void): Promise<PluginListenerHandle>;
  addListener(name: 'connection', listener: (event: NativeConnection) => void): Promise<PluginListenerHandle>;
  addListener(name: 'speech', listener: (event: SpeechEvent) => void): Promise<PluginListenerHandle>;
  addListener(
    name: 'notificationTap',
    listener: (event: { sessionID?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const PocketNative = registerPlugin<PocketNativePlugin>('PocketNative');
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

// The browser preview deliberately keeps credentials in memory, never localStorage.
const browserVault = new Map<string, string>();

export async function vaultRead<T>(key: string): Promise<T | undefined> {
  if (!isNative) {
    const value = browserVault.get(key);
    return value ? (JSON.parse(value) as T) : undefined;
  }
  const { value } = await PocketNative.readSecure({ key });
  return typeof value === 'string' ? (JSON.parse(value) as T) : undefined;
}

export async function vaultWrite(key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  if (isNative) await PocketNative.writeSecure({ key, value: serialized });
  else browserVault.set(key, serialized);
}

export async function vaultRemove(key: string) {
  if (isNative) await PocketNative.removeSecure({ key });
  else browserVault.delete(key);
}
