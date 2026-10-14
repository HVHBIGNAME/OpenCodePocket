import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { type ServerEvent } from '../../shared/protocol';
import { ApiError, errorMessage, OpenCodeClient } from '../lib/api';
import { isNative, platform, PocketNative, vaultRead, vaultWrite } from '../lib/native';
import { applyEvent, emptyData, type LiveData } from './reducer';
import { mergeSnapshot } from './history';
import { reconcileMessages } from './message-events';
import { DraftStore } from './drafts';
import { FavoritesStore, useFavorites } from './favorites';
import { defaultSessionFilters } from '../lib/session-search';
import { isGenerationCancelled } from '../lib/session-errors';
import { NotificationGate } from '../../shared/notification-policy';
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
  const isCurrentClient = useCallback((source: OpenCodeClient) => source === clientRef.current, []);
  const savedRef = useRef<Connection[]>([]);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<LiveData>(emptyData);
  const sessionListView = useRef({ order: [] as string[], scroll: 0, visible: 60 });
  const chatPositions = useRef(new Map<string, { top: number; bottom: boolean }>());
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [sessionFilters, setSessionFilters] = useState(defaultSessionFilters);
  const [historyLimits, setHistoryLimits] = useState<Record<string, number>>({});
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
  const sessionChoices = useRef(new Map<string, { model?: ModelChoice; agent: string }>());
  useEffect(() => {
    if (screen === 'chat' && sessionID) sessionChoices.current.set(sessionID, { model, agent });
  }, [screen, sessionID, model, agent]);
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [refreshing, setRefreshing] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectIntent, setConnectIntent] = useState<'scan' | 'manual'>('manual');
  const [pendingNotification, setPendingNotification] = useState<string>();
  const [pairingInput, setPairingInput] = useState('');
  const [loadingSession, setLoadingSession] = useState<string>();
  const refreshTask = useRef<Promise<void> | undefined>(undefined);
  const messageRequests = useRef(new Map<string, { controller: AbortController; limit: number }>());
  const loadedLimits = useRef(new Map<string, number>());
  const connectionSequence = useRef(0);
  const navigationSequence = useRef(0);
  const streamQueue = useRef(Promise.resolve());
  const session = data.sessions.find((item) => item.id === sessionID);
  useLayoutEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    attachDiagnosticClient(client);
    return () => attachDiagnosticClient(undefined);
  }, [client]);
  useEffect(() => setDiagnosticScreen(screen), [screen]);

  const notify = useCallback((text: string, error = false) => setToast({ text, error }), []);
  const favorites = useMemo(() => new FavoritesStore(), []);
  const favoritesError = useCallback(
    (error: unknown) => notify(`Избранное: ${errorMessage(error)}`, true),
    [notify],
  );
  const favoriteState = useFavorites(favorites, client?.connection.id, favoritesError);
  const toggleFavorite = useCallback(
    async (target: Session) => {
      const id = clientRef.current?.connection.id;
      if (id && !target.parentID) await favorites.toggle(id, target.id);
    },
    [favorites],
  );
  const drafts = useMemo(
    () => new DraftStore((error) => notify(`Черновик: ${errorMessage(error)}`, true)),
    [notify],
  );
  useEffect(() => {
    const flush = () => {
      void drafts.flushAll();
    };
    const hidden = () => {
      if (document.hidden) flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      flush();
    };
  }, [drafts]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadMessages = useCallback(async (target: Session, limit = 100) => {
    const source = clientRef.current;
    if (!source) return;
    const active = messageRequests.current.get(target.id);
    const request = {
      controller: new AbortController(),
      limit: Math.max(limit, loadedLimits.current.get(target.id) ?? 100, active?.limit ?? 100),
    };
    active?.controller.abort();
    messageRequests.current.set(target.id, request);
    const before = dataRef.current.messages[target.id] ?? [];
    const pendingBefore = dataRef.current.pendingMessages[target.id];
    setData((previous) =>
      previous.messages[target.id] && !previous.needsHistory[target.id]
        ? previous
        : {
            ...previous,
            messages: { ...previous.messages, [target.id]: previous.messages[target.id] ?? before },
            needsHistory: { ...previous.needsHistory, [target.id]: false },
          },
    );
    setLoadingSession(target.id);
    try {
      const messages = await source.request<MessageEntry[]>(
        `/session/${encodeURIComponent(target.id)}/message?limit=${request.limit}`,
        { directory: target.directory, signal: request.controller.signal },
      );
      if (!Array.isArray(messages)) throw new Error('Сервер вернул некорректную историю');
      if (source === clientRef.current && !request.controller.signal.aborted) {
        loadedLimits.current.set(target.id, request.limit);
        setHistoryLimits((previous) => ({ ...previous, [target.id]: request.limit }));
        setData((previous) =>
          previous.sessions.some((item) => item.id === target.id)
            ? reconcileMessages(previous, target.id, messages, before, pendingBefore)
            : previous,
        );
      }
    } catch (error) {
      if (!request.controller.signal.aborted && source === clientRef.current) throw error;
    } finally {
      if (messageRequests.current.get(target.id) === request) {
        messageRequests.current.delete(target.id);
        setLoadingSession((id) => (id === target.id ? undefined : id));
      }
    }
  }, []);

  const needsHistory = sessionID ? data.needsHistory[sessionID] : false;
  useEffect(() => {
    const target = sessionRef.current;
    if (needsHistory && target)
      void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
  }, [needsHistory, sessionID, loadMessages, notify]);

  const refresh = useCallback(async (source = clientRef.current) => {
    if (!source || source !== clientRef.current) return;
    if (refreshTask.current) return refreshTask.current;
    const operation = (async () => {
      const before = dataRef.current;
      setRefreshing(true);
      try {
        const [projectResult, providerResult, agentResult, configResult] = await Promise.allSettled([
          source.request<Project[]>('/project'),
          source.request<ProviderList>('/provider'),
          source.request<Agent[]>('/agent'),
          source.request<Config>('/config'),
        ]);
        const projectList = projectResult.status === 'fulfilled' ? projectResult.value : [];
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
              const [q, p, s] = await Promise.allSettled([
                source.request<PendingQuestion[]>('/question', { directory }),
                source.request<PendingPermission[]>('/permission', { directory }),
                source.request<Record<string, SessionStatus>>('/session/status', { directory }),
              ]);
              const inDirectory = (id: string) =>
                before.sessions.find((item) => item.id === id)?.directory === directory;
              return {
                questions:
                  q.status === 'fulfilled'
                    ? q.value.map((item) => ({ ...item, directory }))
                    : before.questions.filter((item) => item.directory === directory),
                permissions:
                  p.status === 'fulfilled'
                    ? p.value.map((item) => ({ ...item, directory }))
                    : before.permissions.filter((item) => item.directory === directory),
                statuses:
                  s.status === 'fulfilled'
                    ? s.value
                    : Object.fromEntries(Object.entries(before.statuses).filter(([id]) => inDirectory(id))),
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
        if (projectResult.status === 'fulfilled') setProjects(projectResult.value);
        if (providerResult.status === 'fulfilled') setProviders(providerResult.value);
        if (agentResult.status === 'fulfilled') setAgents(agentResult.value);
        if (configResult.status === 'fulfilled') setConfig(configResult.value);
        setData((previous) => {
          const nextStatuses = { ...statuses };
          for (const id of Object.keys(before.statuses))
            if (!(id in previous.statuses)) delete nextStatuses[id];
          for (const [id, value] of Object.entries(previous.statuses))
            if (before.statuses[id] !== value) nextStatuses[id] = value;
          return {
            ...previous,
            sessions: mergeSnapshot(
              [...before.sessions.filter((item) => item.parentID), ...sessions],
              before.sessions,
              previous.sessions,
            ),
            statuses: nextStatuses,
            questions: mergeSnapshot(questions, before.questions, previous.questions),
            permissions: mergeSnapshot(permissions, before.permissions, previous.permissions),
          };
        });
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
      const sequence = ++connectionSequence.current;
      const next = new OpenCodeClient(connection);
      const health = persist ? await next.health() : undefined;
      if (sequence !== connectionSequence.current) return;
      if (health && !health.healthy) throw new Error('OpenCode пока не готов');
      if (persist) {
        const saved = [...savedRef.current.filter((item) => item.id !== connection.id), connection];
        await vaultWrite('occ.connections', saved);
        await vaultWrite('occ.lastConnection', connection.id);
        savedRef.current = saved;
        setConnections(saved);
      }
      if (sequence !== connectionSequence.current) return;
      clientRef.current = next;
      for (const request of messageRequests.current.values()) request.controller.abort();
      messageRequests.current.clear();
      loadedLimits.current.clear();
      sessionChoices.current.clear();
      sessionListView.current = { order: [], scroll: 0, visible: 60 };
      chatPositions.current.clear();
      setHistoryLimits({});
      setLoadingSession(undefined);
      setSessionFilters(defaultSessionFilters);
      navigationSequence.current++;
      refreshTask.current = undefined;
      setClient(next);
      setVersion(health?.version ?? '');
      if (!health)
        void next
          .health()
          .then((value) => {
            if (next === clientRef.current) setVersion(value.version);
          })
          .catch((error: unknown) => captureDiagnostic(error, { kind: 'request', operation: 'connect' }));
      setData(emptyData());
      setBridgeInfo(undefined);
      setSessionID(undefined);
      setScreen('sessions');
      setModel(undefined);
      setStatus('connecting');
      void refresh(next).catch((error: unknown) =>
        captureDiagnostic(error, { kind: 'request', operation: 'connect' }),
      );
      if (next === clientRef.current) setConnectOpen(false);
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

  const streamNotifications = platform === 'android' && preferences.notifications;
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let unauthorized = false;
    let upstreamOnline = client.connection.mode !== 'bridge';
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let syncFailures = 0;
    const sync = () => {
      if (cancelled || unauthorized || client !== clientRef.current) return;
      clearTimeout(retryTimer);
      void refresh(client)
        .then(() => {
          syncFailures = 0;
        })
        .catch((error: unknown) => {
          if (cancelled || unauthorized || client !== clientRef.current) return;
          captureDiagnostic(error, { kind: 'request', operation: 'sync' });
          retryTimer = setTimeout(sync, Math.min(15_000, 1000 * 2 ** Math.min(syncFailures++, 4)));
        });
    };
    const alerts = new NotificationGate();
    let stop: (() => Promise<void>) | undefined;
    let hydrateTimer: ReturnType<typeof setTimeout> | undefined;
    const hydrate = () => {
      if (hydrateTimer) return;
      hydrateTimer = setTimeout(() => {
        hydrateTimer = undefined;
        const target = sessionRef.current;
        if (!cancelled && target)
          void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
      }, 120);
    };
    const handleEvent = (event: ServerEvent) => {
      if (cancelled || client !== clientRef.current) return;
      if (event.type === 'occ.unauthorized') {
        unauthorized = true;
        clearTimeout(retryTimer);
        setStatus('offline');
        notify('Доступ отозван. Подключитесь заново.', true);
        return;
      }
      const upstreamRecovered =
        event.type === 'occ.upstream' && event.properties.online === true && !upstreamOnline;
      if (event.type === 'occ.upstream' || event.type === 'occ.connected') {
        upstreamOnline = event.properties.online === true;
        setStatus(upstreamOnline ? 'live' : 'reconnecting');
      }
      if (
        upstreamRecovered ||
        ['occ.resync', 'server.connected', 'global.disposed', 'occ.connected'].includes(event.type)
      ) {
        sync();
        hydrate();
      }
      if (event.type === 'session.error') {
        const error = event.properties.error as { data?: { message?: string } } | undefined;
        if (isGenerationCancelled(error)) hydrate();
        else if (
          !event.properties.sessionID ||
          (event.properties.sessionID === sessionRef.current?.id && alerts.accept(event))
        )
          notify(error?.data?.message ?? 'В сессии произошла ошибка. Проверьте ответ провайдера.', true);
      }
      setData((previous) => applyEvent(previous, event));
      if (
        (event.type.startsWith('session.next.') || event.type === 'session.idle') &&
        event.properties.sessionID === sessionRef.current?.id
      )
        hydrate();
    };
    streamQueue.current = streamQueue.current
      .then(async () => {
        if (cancelled) return;
        stop = await client.events(
          handleEvent,
          (next) => {
            if (cancelled || unauthorized || client !== clientRef.current) return;
            setStatus(next === 'live' && !upstreamOnline ? 'connecting' : next);
            if (next === 'live') {
              sync();
              hydrate();
            }
          },
          streamNotifications,
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus('reconnecting');
          notify(errorMessage(error), true);
        }
      });
    const resume = () => {
      if (document.hidden || cancelled || client !== clientRef.current) return;
      sync();
      hydrate();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      clearTimeout(retryTimer);
      if (hydrateTimer) clearTimeout(hydrateTimer);
      streamQueue.current = streamQueue.current
        .then(async () => {
          await stop?.();
        })
        .catch((error: unknown) => console.error(errorMessage(error)));
    };
  }, [client, streamNotifications, loadMessages, notify, refresh]);

  const openSession = useCallback(
    (target: Session) => {
      navigationSequence.current++;
      setSessionID(target.id);
      setScreen('chat');
      const choice = sessionChoices.current.get(target.id);
      if (choice) setModel(choice.model);
      else if (target.model)
        setModel({
          providerID: target.model.providerID,
          modelID: target.model.id,
          variant: target.model.variant,
        });
      else if (config.model) {
        const [providerID, ...name] = config.model.split('/');
        setModel(providerID && name.length ? { providerID, modelID: name.join('/') } : undefined);
      } else setModel(undefined);
      setAgent(choice?.agent ?? target.agent ?? config.default_agent ?? 'build');
      void loadMessages(target).catch((error: unknown) => notify(errorMessage(error), true));
    },
    [config.default_agent, config.model, loadMessages, notify],
  );

  const openRelatedSession = useCallback(
    async (id: string, directory?: string) => {
      const source = clientRef.current;
      if (!source) throw new Error('Нет подключения');
      const sequence = ++navigationSequence.current;
      const target = await source.request<Session>(`/session/${encodeURIComponent(id)}`, { directory });
      if (source !== clientRef.current || sequence !== navigationSequence.current) return;
      if (!target?.id || !target.directory) throw new Error('Сессия агента недоступна');
      setData((previous) => ({
        ...previous,
        sessions: [...previous.sessions.filter((item) => item.id !== target.id), target],
      }));
      openSession(target);
    },
    [openSession],
  );

  useEffect(() => {
    if (!client || !sessionID || !session?.directory) return;
    const controller = new AbortController();
    let loading = false;
    const before = dataRef.current.sessions;
    const loadChildren = async () => {
      if (loading) return;
      loading = true;
      try {
        const children = await client.request<Session[]>(
          `/session/${encodeURIComponent(sessionID)}/children`,
          { directory: session.directory, signal: controller.signal },
        );
        if (controller.signal.aborted || !Array.isArray(children)) return;
        setData((previous) => ({
          ...previous,
          sessions: mergeSnapshot(
            [...before.filter((item) => item.parentID !== sessionID), ...children],
            before,
            previous.sessions,
          ),
        }));
      } catch (error) {
        if (!controller.signal.aborted) captureDiagnostic(error, { kind: 'request' });
      } finally {
        loading = false;
      }
    };
    void loadChildren();
    return () => {
      controller.abort();
    };
  }, [client, sessionID, session?.directory]);

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
          else {
            setPendingNotification(link.searchParams.get('id') ?? undefined);
            setScreen('inbox');
          }
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
        } else void drafts.flushAll();
      }),
      PocketNative.addListener('notificationTap', ({ sessionID: id }) => {
        const target = data.sessions.find((item) => item.id === id);
        if (target) openSession(target);
        else {
          setPendingNotification(id);
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
        else if (
          screen === 'chat' &&
          !document.dispatchEvent(new Event('pocket:navigate-back', { cancelable: true }))
        )
          return;
        else if (screen === 'chat' && sessionRef.current?.parentID) {
          void openRelatedSession(sessionRef.current.parentID, sessionRef.current.directory).catch(
            (error: unknown) => notify(errorMessage(error), true),
          );
        } else if (screen === 'chat') setScreen('sessions');
        else if (screen !== 'sessions') setScreen('sessions');
        else void NativeApp.minimizeApp();
      }),
    ];
    return () => {
      for (const handle of handles) void handle.then((value) => value.remove());
    };
  }, [
    data.sessions,
    openSession,
    openRelatedSession,
    loadMessages,
    refresh,
    notify,
    connectOpen,
    screen,
    drafts,
  ]);

  useEffect(() => {
    if (!isNative) return;
    void NativeApp.getLaunchUrl().then((launch) => {
      if (launch?.url.startsWith('occ://pair?')) {
        setPairingInput(launch.url);
        setConnectOpen(true);
      }
      if (launch?.url.startsWith('occ://session?'))
        setPendingNotification(new URL(launch.url).searchParams.get('id') ?? undefined);
    });
  }, []);

  useEffect(() => {
    if (!client || !pendingNotification) return;
    setPendingNotification(undefined);
    if (!/^ses_[\w-]+$/.test(pendingNotification)) return;
    const target = data.sessions.find((item) => item.id === pendingNotification);
    if (target) {
      openSession(target);
    } else {
      const request = [...data.questions, ...data.permissions].find(
        (item) => item.sessionID === pendingNotification,
      );
      void openRelatedSession(pendingNotification, request?.directory).catch((error: unknown) =>
        notify(errorMessage(error), true),
      );
    }
  }, [
    client,
    pendingNotification,
    data.sessions,
    data.questions,
    data.permissions,
    openSession,
    openRelatedSession,
    notify,
  ]);

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

  const forget = useCallback(
    async (id: string) => {
      const saved = savedRef.current.filter((item) => item.id !== id);
      await vaultWrite('occ.connections', saved);
      await favorites.remove(id);
      savedRef.current = saved;
      setConnections(saved);
      if (clientRef.current?.connection.id === id) {
        connectionSequence.current++;
        for (const request of messageRequests.current.values()) request.controller.abort();
        messageRequests.current.clear();
        loadedLimits.current.clear();
        sessionChoices.current.clear();
        setHistoryLimits({});
        sessionListView.current = { order: [], scroll: 0, visible: 60 };
        chatPositions.current.clear();
        setLoadingSession(undefined);
        refreshTask.current = undefined;
        clientRef.current = undefined;
        setClient(undefined);
        setStatus('offline');
        setData(emptyData());
        setProjects([]);
        setProviders({ all: [], connected: [], default: {} });
        setAgents([]);
        setConfig({});
        setModel(undefined);
        setBridgeInfo(undefined);
        setSessionID(undefined);
        setScreen('sessions');
      }
    },
    [favorites],
  );

  const saveConfig = useCallback(
    async (patch: Partial<Config>) => {
      const source = clientRef.current;
      if (!source) throw new Error('Сначала подключитесь к компьютеру');
      const updated = await source.request<Config>('/global/config', {
        method: 'PATCH',
        data: patch,
      });
      if (source !== clientRef.current) return;
      setConfig(updated);
      notify('Сохранено на компьютере. Некоторые плагины применят изменения после перезапуска OpenCode.');
      await refresh();
    },
    [notify, refresh],
  );

  const createSession = useCallback(
    async (title: string, directory?: string) => {
      const source = clientRef.current;
      if (!source) throw new Error('Сначала подключитесь к компьютеру');
      const created = await source.request<Session>('/session', {
        method: 'POST',
        data: { title: title.trim() || undefined },
        directory,
      });
      if (source !== clientRef.current) return created;
      setData((previous) => ({
        ...previous,
        sessions: [created, ...previous.sessions.filter((item) => item.id !== created.id)],
      }));
      openSession(created);
      return created;
    },
    [openSession],
  );

  const archiveSession = useCallback(
    async (target: Session, archived: boolean) => {
      const source = clientRef.current;
      if (!source) throw new Error('Сначала подключитесь к компьютеру');
      const updated = await source.request<Session>(`/session/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        directory: target.directory,
        data: { time: { archived: archived ? Date.now() : 0 } },
      });
      if (source !== clientRef.current) return;
      setData((previous) => ({
        ...previous,
        sessions: [...previous.sessions.filter((item) => item.id !== updated.id), updated],
      }));
      if (archived) setScreen('sessions');
      notify(archived ? 'Сессия перенесена в архив' : 'Сессия восстановлена');
    },
    [notify],
  );

  const haptic = useCallback(() => {
    if (isNative && preferences.haptics)
      void Haptics.impact({ style: ImpactStyle.Light }).catch((error: unknown) =>
        captureDiagnostic(error, { kind: 'action' }),
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
    isCurrentClient,
    data,
    sessionListView,
    chatPositions,
    drafts,
    favoriteState,
    toggleFavorite,
    sessionFilters,
    setSessionFilters,
    historyLimits,
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
    openRelatedSession,
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
    messageLoading: loadingSession === sessionID,
    pendingCount,
    connectedModels,
    forget,
    saveConfig,
    createSession,
    archiveSession,
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
