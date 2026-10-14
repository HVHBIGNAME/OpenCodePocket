import type { Command, MessageEntry, ModelChoice, Session } from '../types';
import type { OpenCodeClient } from './api';

export const builtinCommands = [
  { name: 'compact', description: 'Сжать контекст сессии' },
  { name: 'undo', description: 'Отменить последнее сообщение и его изменения файлов' },
  { name: 'redo', description: 'Вернуть отменённое сообщение и изменения' },
  { name: 'fork', description: 'Продолжить эту историю в новой сессии' },
  { name: 'new', description: 'Новая сессия в этом проекте' },
  { name: 'models', description: 'Выбрать модель по провайдеру' },
  { name: 'sessions', description: 'Перейти к списку сессий' },
  { name: 'themes', description: 'Выбрать тему оформления' },
  { name: 'connect', description: 'Подключить провайдера модели' },
  { name: 'share', description: 'Создать ссылку на этот диалог' },
  { name: 'unshare', description: 'Отключить общую ссылку' },
] as const;
export type BuiltinName = (typeof builtinCommands)[number]['name'];
export type SlashCommand = { name: string; description?: string; builtin?: BuiltinName };
export function commandCatalog(server: Command[]): SlashCommand[] {
  const catalog = new Map<string, SlashCommand>(
    builtinCommands.map((command) => [command.name, { ...command, builtin: command.name }]),
  );
  for (const command of server) if (!catalog.has(command.name)) catalog.set(command.name, command);
  return [...catalog.values()];
}
export function commandSuggestions(catalog: SlashCommand[], draft: string) {
  if (!/^\/[^\s]*$/.test(draft)) return [];
  const query = draft.slice(1).toLocaleLowerCase();
  return catalog
    .filter((command) => command.name.toLocaleLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(b.name.startsWith(query)) - Number(a.name.startsWith(query)) || a.name.localeCompare(b.name),
    );
}

export async function runSessionCommand(
  name: BuiltinName,
  client: OpenCodeClient,
  session: Session,
  entries: MessageEntry[],
  model?: ModelChoice,
) {
  const request = <T>(action: string, data?: unknown) =>
    client.request<T>(`/session/${encodeURIComponent(session.id)}/${action}`, {
      method: 'POST',
      directory: session.directory,
      data,
    });
  if (name === 'compact') {
    const choice =
      model ??
      entries
        .slice()
        .reverse()
        .find((entry) => entry.info.role === 'user')?.info;
    const selected =
      choice && 'modelID' in choice ? choice : choice?.role === 'user' ? choice.model : undefined;
    if (!selected) throw new Error('Выбери модель перед сжатием контекста.');
    if (!entries.some((entry) => entry.info.role === 'user'))
      throw new Error('В сессии пока нет сообщений для сжатия.');
    await request('summarize', { providerID: selected.providerID, modelID: selected.modelID, auto: false });
    return {};
  }
  if (name === 'undo' || name === 'redo') {
    const users = entries.filter((entry) => entry.info.role === 'user');
    const boundary = session.revert?.messageID;
    if (name === 'redo' && !boundary) throw new Error('Нет отменённых сообщений.');
    const target =
      name === 'undo'
        ? users
            .slice()
            .reverse()
            .find((entry) => !boundary || entry.info.id < boundary)
        : users.find((entry) => entry.info.id > boundary!);
    if (name === 'undo' && !target)
      throw new Error('Нет загруженных сообщений для отмены. Загрузи более раннюю историю.');
    const updated = target
      ? await request<Session>('revert', { messageID: target.info.id })
      : await request<Session>('unrevert');
    return {
      session: updated,
      text:
        name === 'undo' && target
          ? target.parts
              .filter((part) => part.type === 'text' && !part.ignored)
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('\n')
          : '',
    };
  }
  if (name === 'fork') return { fork: await request<Session>('fork', {}) };
  if (name === 'share') return { session: await request<Session>('share') };
  if (name === 'unshare')
    return {
      session: await client.request<Session>(`/session/${encodeURIComponent(session.id)}/share`, {
        method: 'DELETE',
        directory: session.directory,
      }),
    };
  throw new Error('Команда не является операцией с сессией.');
}
