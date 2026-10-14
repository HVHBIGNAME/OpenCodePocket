import { useEffect, useRef, useState } from 'react';
import { usePocket } from '../store/PocketProvider';
import { runSessionCommand, type BuiltinName } from '../lib/commands';
import type { Session } from '../types';

export function useSessionCommands(session: Session, chooseModels: () => void) {
  const { client, data, model, setData, setScreen, createSession, openSession, notify, isCurrentClient } =
    usePocket();
  const [sharedURL, setSharedURL] = useState<string>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runBuiltin = async (name: BuiltinName) => {
    if (!client) throw new Error('Нет подключения');
    switch (name) {
      case 'models':
        chooseModels();
        return '';
      case 'sessions':
        setScreen('sessions');
        return '';
      case 'themes':
        setScreen('settings');
        return '';
      case 'connect':
        setScreen('models');
        return '';
      case 'new':
        await createSession('', session.directory);
        return '';
    }
    const result = await runSessionCommand(name, client, session, data.messages[session.id] ?? [], model);
    if (!isCurrentClient(client)) return result.text ?? '';
    if (result.session) {
      const updated = result.session;
      setData((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) => (item.id === updated.id ? updated : item)),
      }));
      if (name === 'share' && mounted.current) setSharedURL(updated.share?.url);
    }
    if (result.fork) {
      const fork = result.fork;
      setData((previous) => ({
        ...previous,
        sessions: [...previous.sessions.filter((item) => item.id !== fork.id), fork],
      }));
      if (mounted.current) openSession(fork);
    }
    if (name === 'compact') notify('Контекст сессии сжат.');
    return result.text ?? '';
  };
  return { runBuiltin, sharedURL, setSharedURL };
}
