export type {
  Session,
  Message,
  Part,
  Config,
  Agent,
  Project,
  QuestionRequest,
  PermissionRequest,
  Todo,
  SnapshotFileDiff,
  FileNode,
  FileContent,
  Command,
  SessionStatus,
} from '@opencode-ai/sdk/v2';
import type { Message, Part, QuestionRequest, PermissionRequest } from '@opencode-ai/sdk/v2';

export type MessageEntry = { info: Message; parts: Part[] };
export type Model = {
  id: string;
  name: string;
  providerID?: string;
  family?: string;
  limit?: { context: number; output: number };
  cost?: { input: number; output: number };
  capabilities?: { reasoning?: boolean; attachment?: boolean; toolcall?: boolean };
  reasoning?: boolean;
  attachment?: boolean;
  variants?: Record<string, Record<string, unknown>>;
};
export type Provider = { id: string; name: string; models: Record<string, Model> };
export type ProviderList = { all: Provider[]; connected: string[]; default: Record<string, string> };
export type ModelChoice = { providerID: string; modelID: string; variant?: string };
export type Profile = {
  id: string;
  name: string;
  url: string;
  mode: 'bridge' | 'direct';
  directory?: string;
  username?: string;
  deviceID?: string;
};
export type Connection = Profile & { credential: string };
export type PendingQuestion = QuestionRequest & { directory?: string };
export type PendingPermission = PermissionRequest & { directory?: string };
export type BridgeInfo = {
  version: string;
  name: string;
  online: boolean;
  deviceID: string;
  push: {
    apns: boolean;
    ntfy: boolean;
    registered?: boolean;
    ntfyTopic?: string;
    sharedNtfy?: boolean;
    setup?: boolean;
  };
  reports?: { github: boolean; repository: string };
};
export type Device = { id: string; name: string; created: number; current: boolean };
export type Preferences = {
  notifications: boolean;
  offlineSpeech: boolean;
  speechLocale: string;
  haptics: boolean;
  diagnostics: boolean;
};
export type Screen = 'overview' | 'sessions' | 'chat' | 'models' | 'inbox' | 'settings';
