import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type NativeEvent = { data: string };
type NativeConnection = { state: 'connected' | 'reconnecting'; message?: string };
export type SpeechEvent = {
  id?: string;
  text?: string;
  final?: boolean;
  error?: string;
  state?: 'idle' | 'listening' | 'finishing';
};
export type AppearanceCapabilities = {
  nativeGlass: boolean;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  lowPower: boolean;
};
export type GlassRegion = { id: string; x: number; y: number; width: number; height: number; radius: number };
export type KeyboardFrame = {
  viewportHeight: number;
  viewportWidth: number;
  keyboardHeight: number;
  duration: number;
  curve: number;
};

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
  startSpeech(options: { id?: string; locale: string; offline: boolean }): Promise<void>;
  stopSpeech(options?: { cancel?: boolean }): Promise<void>;
  getKeyboardFrame(): Promise<KeyboardFrame>;
  requestNotifications(): Promise<{ granted: boolean }>;
  notificationStatus(): Promise<{ status: 'granted' | 'denied' | 'prompt' }>;
  openNotificationSettings(): Promise<void>;
  registerPush(): Promise<{ token: string }>;
  appearanceCapabilities(): Promise<AppearanceCapabilities>;
  setGlassAppearance(options: { enabled: boolean; dark: boolean }): Promise<{ enabled: boolean }>;
  setGlassRegions(options: { viewportWidth: number; regions: GlassRegion[] }): Promise<void>;
  addListener(
    name: 'appearanceAccessibility',
    listener: (event: AppearanceCapabilities) => void,
  ): Promise<PluginListenerHandle>;
  addListener(name: 'serverEvent', listener: (event: NativeEvent) => void): Promise<PluginListenerHandle>;
  addListener(name: 'connection', listener: (event: NativeConnection) => void): Promise<PluginListenerHandle>;
  addListener(name: 'speech', listener: (event: SpeechEvent) => void): Promise<PluginListenerHandle>;
  addListener(name: 'keyboardFrame', listener: (event: KeyboardFrame) => void): Promise<PluginListenerHandle>;
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
