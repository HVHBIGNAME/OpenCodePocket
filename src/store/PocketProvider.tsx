import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { type ServerEvent } from '../../shared/protocol';
import { ApiError, errorMessage, OpenCodeClient } from '../lib/api';
import { isNative, PocketNative, vaultRead, vaultWrite } from '../lib/native';
import { applyEvent, emptyData, type LiveData } from './reducer';
import { isGenerationCancelled } from '../lib/session-errors';
import {
  attachDiagnosticClient,
  captureDiagnostic,
  setDiagnosticScreen,
  setDiagnosticsEnabled,
} from '../lib/diagnostics';
import type {
  Agent,
  BridgeInfo,
  Config,
  Connection,
  MessageEntry,
  ModelChoice,
  Preferences,
  Project,
  ProviderList,
  Screen,
  Session,
  SessionStatus,
  PendingPermission,
  PendingQuestion,
} from '../types';

const defaultPreferences: Preferences = {
  notifications: false,
  offlineSpeech: true,
  speechLocale: 'ru-RU',
  haptics: true,
  diagnostics: true,
};

function usePocketState() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [client, setClient] = useState<OpenCodeClient>();
  const clientRef = useRef<OpenCodeClient | undefined>(undefined);
  const savedRef = useRef<Connection[]>([]);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<LiveData>(emptyData);
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderList>({ all: [], connected: [], default: {} });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [config, setConfig] = useState<Config>({});
  const [bridgeInfo, setBridgeInfo] = useState<BridgeInfo>();
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<'offline' | 'connecting' | 'live' | 'reconnecting'>('offline');
  const [preferences, setPreferencesState] = useState<Preferences>(defaultPreferences);
  const [screen, setScreen] = useState<Screen>('sessions');
  const [sessionID, setSessionID] = useState<string>();
  const sessionRef = useRef<Session | undefined>(undefined);
  const [model, setModel] = useState<ModelChoice>();
  const [agent, setAgent] = useState('build');
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [refreshing, setRefreshing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectIntent, setConnectIntent] = useState<'scan' | 'manual'>('manual');
  const pendingNotification = useRef<string | undefined>(undefined);
  const [pairingInput, setPairingInput] = useState('');
  const [messageLoading, setMessageLoading] = useState(false);
  const refreshTask = useRef<Promise<void> | undefined>(undefined);
  const messageSequence = useRef(0);
  const streamQueue = useRef(Promise.resolve());
  const session = data.sessions.find((item) => item.id === sessionID);
  sessionRef.current = session;
  useEffect(() => {
    attachDiagnosticClient(client);
    return () => attachDiagnosticClient(undefined);
  }, [client]);
  useEffect(() => setDiagnosticScreen(screen), [screen]);

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadMessages = useCallback(async (target: Session, limit = 100) => {
    const source = clientRef.current;
    if (!source) return;
    const sequence = ++messageSequence.current;
    setMessageLoading(true);
    try {
      const messages = await source.request<MessageEntry[]>(
        `/session/${encodeURIComponent(target.id)}/message?limit=${limit}`,
        { directory: target.directory },
      );
      if (!Array.isArray(messages)) throw new Error('Сервер вернул некорректную историю');
      if (source === clientRef.current && sequence === messageSequence.current) {
        setData((previous) => ({ ...previous, messages: { ...previous.messages, [target.id]: messages } }));
      }
    } finally {
      if (sequence === messageSequence.current) setMessageLoading(false);
    }
  }, []);

  const refresh = useCallback(async (source = clientRef.current) => {
    if (!source) return;
    if (refreshTask.current) return refreshTask.current;
    const operation = (async () => {
      setRefreshing(true);
      try {
        const [projectList, providerList, agentList, configuration] = await Promise.all([
          source.request<Project[]>('/project'),
          source.request<ProviderList>('/provider'),
          source.request<Agent[]>('/agent'),
          source.request<Config>('/config'),
        ]);
        const sessions = await source.allSessions(projectList);
        const directories = [
          ...new Set([source.connection.directory, ...sessions.map((item) => item.directory)]),
        ];
        let questions: PendingQuestion[] = [];
        let permissions: PendingPermission[] = [];
        let statuses: Record<string, SessionStatus> = {};
        for (let index = 0; index < directories.length; index += 4) {
          const results = await Promise.all(
            directories.slice(index, index + 4).map(async (directory) => {
              const [q, p, s] = await Promise.all([
                source.request<PendingQuestion[]>('/question', { directory }),
                source.request<PendingPermission[]>('/permission', { directory }),
                source.request<Record<string, SessionStatus>>('/session/status', { directory }),
              ]);
              return {
                questions: q.map((item) => ({ ...item, directory })),
                permissions: p.map((item) => ({ ...item, directory })),
                statuses: s,
              };
            }),
          );
          for (const result of results) {
            questions.push(...result.questions);
            permissions.push(...result.permissions);
            statuses = { ...statuses, ...result.statuses };
          }
        }
        questions = [...new Map(questions.map((item) => [item.id, item])).values()];
        permissions = [...new Map(permissions.map((item) => [item.id, item])).values()];
        if (source !== clientRef.current) return;
        setProjects(projectList);
        setProviders(providerList);
        setAgents(agentList);
        setConfig(configuration);
        setData((previous) => ({ ...previous, sessions, statuses, questions, permissions }));
        if (source.connection.mode === 'bridge') {
          const info = await source.companion<BridgeInfo>('/info');
          if (source === clientRef.current) setBridgeInfo(info);
        }
      } finally {
        if (source === clientRef.current) setRefreshing(false);
      }
    })();
    refreshTask.current = operation;
    try {
      await operation;
    } finally {
      if (refreshTask.current === operation) refreshTask.current = undefined;
    }
  }, []);

  const connect = useCallback(
    async (connection: Connection, persist = true) => {
      const next = new OpenCodeClient(connection);
      const health = await next.health();
      if (!health.healthy) throw new Error('OpenCode пока не готов');
      if (persist) {
        const saved = [...savedRef.current.filter((item) => item.id !== connection.id), connection];
        await vaultWrite('occ.connections', saved);
        await vaultWrite('occ.lastConnection', connection.id);
        savedRef.current = saved;
        setConnections(saved);
      }
      clientRef.current = next;
      refreshTask.current = undefined;
      setClient(next);
      setVersion(health.version);
      setData(emptyData());
      setBridgeInfo(undefined);
      setSessionID(undefined);
      setScreen('sessions');
      setModel(undefined);
      setStatus('connecting');
      await refresh(next);
      setConnectOpen(false);
    },
    [refresh],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [saved, prefs, last] = await Promise.all([
        vaultRead<Connection[]>('occ.connections'),
        vaultRead<Preferences>('occ.preferences'),
        vaultRead<string>('occ.lastConnection'),
      ]);
      if (!alive) return;
      if (prefs) setPreferencesState({ ...defaultPreferences, ...prefs });
      if (saved) {
        savedRef.current = saved;
        setConnections(saved);
      }
      const active = saved?.find((item) => item.id === last) ?? saved?.[0];
      if (active) {
        try {
          await connect(active, false);
        } catch (error) {
          notify(`Сервер недоступен: ${errorMessage(error)}`, true);
        }
      }
    })()
      .catch((error: unknown) => notify(`Хранилище: ${errorMessage(error)}`, true))
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [connect, notify]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let stop: (() => Promise<void>) | undefined;
    let hydrateTimer: ReturnType<typeof setTimeout> | undefined;
    const hydrate = () => {
      if (hydrateTimer) return;
      hydrateTimer = setTimeout(() => {
        hydrateTimer = undefined;
        const target = sessionRef.current;
        if (!cancelled && target)
          void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
      }, 600);
    };
    const handleEvent = (event: ServerEvent) => {
      if (cancelled) return;
      if (event.type === 'occ.unauthorized') {
        setStatus('offline');
        notify('Доступ отозван. Подключитесь заново.', true);
        return;
      }
      if (event.type === 'occ.upstream' || event.type === 'occ.connected') {
        if (event.properties.online === false) setStatus('reconnecting');
        else if (event.properties.online === true) setStatus('live');
      }
      if (['occ.resync', 'server.connected', 'global.disposed', 'occ.connected'].includes(event.type)) {
        void refresh(client).catch((error: unknown) => notify(errorMessage(error), true));
        hydrate();
      }
      if (event.type === 'session.error') {
        const error = event.properties.error as { data?: { message?: string } } | undefined;
        if (isGenerationCancelled(error)) hydrate();
        else notify(error?.data?.message ?? 'В сессии произошла ошибка. Проверьте ответ провайдера.', true);
      }
      setData((previous) => applyEvent(previous, event));
      if (event.type.startsWith('session.next.') || event.type === 'session.idle') hydrate();
    };
    streamQueue.current = streamQueue.current
      .then(async () => {
        if (cancelled) return;
        stop = await client.events(
          handleEvent,
          (next) => {
            if (cancelled) return;
            setStatus(next);
            if (next === 'live') {
              void refresh(client).catch((error: unknown) => notify(errorMessage(error), true));
              hydrate();
            }
          },
          preferences.notifications,
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus('reconnecting');
          notify(errorMessage(error), true);
        }
      });
    const interval = setInterval(() => {
      if (!document.hidden) void refresh(client).catch(() => setStatus('reconnecting'));
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (hydrateTimer) clearTimeout(hydrateTimer);
      streamQueue.current = streamQueue.current
        .then(async () => {
          await stop?.();
        })
        .catch((error: unknown) => console.error(errorMessage(error)));
    };
  }, [client, preferences.notifications, loadMessages, notify, refresh]);

  const openSession = useCallback(
    (target: Session) => {
      setSessionID(target.id);
      setScreen('chat');
      if (target.model)
        setModel({
          providerID: target.model.providerID,
          modelID: target.model.id,
          variant: target.model.variant,
        });
      else if (config.model) {
        const [providerID, ...name] = config.model.split('/');
        if (providerID && name.length) setModel({ providerID, modelID: name.join('/') });
      }
      setAgent(target.agent ?? config.default_agent ?? 'build');
      void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
    },
    [config.default_agent, config.model, loadMessages, notify],
  );

  useEffect(() => {
    if (!isNative) return;
    const handleUrl = ({ url }: { url: string }) => {
      try {
        const link = new URL(url);
        if (link.protocol !== 'occ:') return;
        if (link.hostname === 'pair') {
          setPairingInput(url);
          setConnectOpen(true);
        } else if (link.hostname === 'session') {
          const target = data.sessions.find((item) => item.id === link.searchParams.get('id'));
          if (target) openSession(target);
          else setScreen('inbox');
        } else if (link.hostname === 'inbox') setScreen('inbox');
      } catch (error) {
        notify(errorMessage(error), true);
      }
    };
    const handles = [
      NativeApp.addListener('appUrlOpen', handleUrl),
      NativeApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          void refresh().catch((error: unknown) => notify(errorMessage(error), true));
          const target = sessionRef.current;
          if (target) void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
        }
      }),
      PocketNative.addListener('notificationTap', ({ sessionID: id }) => {
        const target = data.sessions.find((item) => item.id === id);
        if (target) openSession(target);
        else {
          pendingNotification.current = id;
          setScreen('inbox');
        }
      }),
      NativeApp.addListener('backButton', () => {
        const dialog = document.querySelector('dialog[open]');
        if (dialog) {
          dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
          return;
        }
        if (connectOpen) setConnectOpen(false);
        else if (screen === 'chat') setScreen('sessions');
        else if (screen !== 'sessions') setScreen('sessions');
        else void NativeApp.minimizeApp();
      }),
    ];
    return () => {
      for (const handle of handles) void handle.then((value) => value.remove());
    };
  }, [data.sessions, openSession, loadMessages, refresh, notify, connectOpen, screen]);

  useEffect(() => {
    if (!isNative) return;
    void NativeApp.getLaunchUrl().then((launch) => {
      if (launch?.url.startsWith('occ://pair?')) {
        setPairingInput(launch.url);
        setConnectOpen(true);
      }
      if (launch?.url.startsWith('occ://session?'))
        pendingNotification.current = new URL(launch.url).searchParams.get('id') ?? undefined;
    });
  }, []);

  useEffect(() => {
    const target = data.sessions.find((item) => item.id === pendingNotification.current);
    if (target) {
      pendingNotification.current = undefined;
      openSession(target);
    }
  }, [data.sessions, openSession]);

  const perform = useCallback(
    async (operation: () => Promise<unknown>, success?: string) => {
      try {
        await operation();
        if (success) notify(success);
        return true;
      } catch (error) {
        captureDiagnostic(error, { kind: 'action' });
        notify(errorMessage(error), true);
        return false;
      }
    },
    [notify],
  );

  const setPreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      const next = { ...preferences, ...patch };
      await vaultWrite('occ.preferences', next);
      setPreferencesState(next);
      if (patch.diagnostics !== undefined) await setDiagnosticsEnabled(patch.diagnostics);
    },
    [preferences],
  );

  const forget = useCallback(async (id: string) => {
    const saved = savedRef.current.filter((item) => item.id !== id);
    await vaultWrite('occ.connections', saved);
    savedRef.current = saved;
    setConnections(saved);
    if (clientRef.current?.connection.id === id) {
      clientRef.current = undefined;
      setClient(undefined);
      setStatus('offline');
      setData(emptyData());
      setSessionID(undefined);
      setScreen('sessions');
    }
  }, []);

  const saveConfig = useCallback(
    async (patch: Partial<Config>) => {
      if (!clientRef.current) throw new Error('Сначала подключитесь к компьютеру');
      const updated = await clientRef.current.request<Config>('/global/config', {
        method: 'PATCH',
        data: patch,
      });
      setConfig(updated);
      notify('Сохранено на компьютере. Некоторые плагины применят изменения после перезапуска OpenCode.');
      await refresh();
    },
    [notify, refresh],
  );

  const createSession = useCallback(
    async (title: string, directory?: string) => {
      if (!clientRef.current) throw new Error('Сначала подключитесь к компьютеру');
      const created = await clientRef.current.request<Session>('/session', {
        method: 'POST',
        data: { title: title.trim() || undefined },
        directory,
      });
      setData((previous) => ({ ...previous, sessions: [created, ...previous.sessions] }));
      openSession(created);
      return created;
    },
    [openSession],
  );

  const haptic = useCallback(() => {
    if (isNative && preferences.haptics)
      void Haptics.impact({ style: ImpactStyle.Light }).catch((error: unknown) =>
        console.debug('Haptics unavailable', errorMessage(error)),
      );
  }, [preferences.haptics]);

  const pendingCount = data.questions.length + data.permissions.length;
  const connectedModels = useMemo(
    () =>
      providers.all
        .filter((provider) => providers.connected.includes(provider.id))
        .flatMap((provider) =>
          Object.values(provider.models).map((item) => ({
            ...item,
            providerID: provider.id,
            providerName: provider.name,
          })),
        ),
    [providers],
  );

  return {
    ready,
    connections,
    client,
    data,
    setData,
    projects,
    providers,
    agents,
    config,
    bridgeInfo,
    version,
    status,
    preferences,
    setPreferences,
    screen,
    setScreen,
    session,
    sessionID,
    openSession,
    model,
    setModel,
    agent,
    setAgent,
    toast,
    setToast,
    notify,
    perform,
    refresh,
    refreshing,
    connect,
    connectOpen,
    setConnectOpen,
    connectIntent,
    setConnectIntent,
    pairingInput,
    setPairingInput,
    loadMessages,
    messageLoading,
    pendingCount,
    connectedModels,
    forget,
    saveConfig,
    createSession,
    haptic,
  };
}

type PocketState = ReturnType<typeof usePocketState>;
const PocketContext = createContext<PocketState | null>(null);
export function PocketProvider({ children }: { children: ReactNode }) {
  const state = usePocketState();
  return <PocketContext.Provider value={state}>{children}</PocketContext.Provider>;
}
export function usePocket() {
  const context = useContext(PocketContext);
  if (!context) throw new ApiError(500, 'PocketProvider missing');
  return context;
}
