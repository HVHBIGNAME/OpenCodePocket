import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge } from '../../packages/bridge/src/server';
import type { Config, Message, MessageEntry, Part, Session } from '../../src/types';

const output = new Set<ServerResponse>();
const directory = 'C:/coding/emberdeck';
const fixtureRoot = join(process.cwd(), '.cache', 'fixture');
const now = Date.now();
let sequence = 0;
let events = 0;
let bridge: Awaited<ReturnType<typeof createBridge>>;
let stateDirectory: string;
let config: Config;
let sessions: Session[];
let messages: Record<string, MessageEntry[]>;
let questions: Record<string, unknown>[];
let permissions: Record<string, unknown>[];
let prompts: Record<string, unknown>[];
let replies: unknown[];
let providerKeys: string[];

function reset() {
  config = {
    model: 'anthropic/claude-sonnet-4-6',
    default_agent: 'build',
    permission: { read: 'allow', edit: 'ask', bash: { '*': 'ask', 'git status*': 'allow' } },
  };
  prompts = [];
  replies = [];
  providerKeys = [];
  sessions = [
    ['ses_panel', 'Панель управления — новая архитектура', 'emberdeck', 1],
    ['ses_auth', 'OAuth и управление сессиями', 'OpenCodePocket', 8],
    ['ses_bcore', 'Оптимизация генерации чанков', 'BCore', 23],
    ['ses_plugins', 'Система плагинов и события', 'emberdeck', 55],
    ['ses_docs', 'Обновить документацию API', 'OpenCodePocket', 120],
  ].map(([id, title, project, age], index) => ({
    id: String(id),
    title: String(title),
    projectID: 'project',
    slug: String(id),
    directory: `C:/coding/${project}`,
    version: '1.18.34',
    time: { created: now - 86400000, updated: now - Number(age) * 60000 },
    summary: {
      additions: [146, 83, 212, 54, 28][index]!,
      deletions: [32, 17, 61, 9, 4][index]!,
      files: index + 2,
    },
  }));
  const sessionID = 'ses_panel';
  messages = {
    [sessionID]: [
      {
        info: {
          id: 'msg_user',
          sessionID,
          role: 'user',
          time: { created: now - 300000 },
          agent: 'build',
          model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
        },
        parts: [
          {
            id: 'prt_user',
            messageID: 'msg_user',
            sessionID,
            type: 'text',
            text: 'Давай разделим панель на независимые модули. Начни с управления серверами и добавь типизированные события.',
          },
        ],
      },
      {
        info: {
          id: 'msg_answer',
          sessionID,
          role: 'assistant',
          time: { created: now - 280000, completed: now - 60000 },
          parentID: 'msg_user',
          modelID: 'claude-sonnet-4-6',
          providerID: 'anthropic',
          mode: 'build',
          agent: 'build',
          path: { cwd: directory, root: directory },
          cost: 0.024,
          tokens: { input: 3240, output: 786, reasoning: 0, cache: { read: 1400, write: 0 } },
        },
        parts: [
          {
            id: 'prt_answer',
            messageID: 'msg_answer',
            sessionID,
            type: 'text',
            text: 'Начну с границ модулей. У каждого будет свой публичный API, а общение между ними — через типизированную шину событий.\n\n### Предлагаемая структура\n\n```ts\nexport interface ServerEvents {\n  "server.started": { id: string; port: number };\n  "server.stopped": { id: string; reason: string };\n}\n```\n\n**Что уже готово:**\n- Выделен модуль `servers`\n- Добавлена проверка входных данных\n- Типы событий доступны всем модулям',
          },
          {
            id: 'prt_tool',
            messageID: 'msg_answer',
            sessionID,
            type: 'tool',
            callID: 'call_test',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'npm run test' },
              output: '✓ server lifecycle (4 tests)\n✓ typed event bus (6 tests)\n\n10 passed',
              title: 'Проверка модулей',
              metadata: {},
              time: { start: now - 70000, end: now - 65000 },
            },
          },
          {
            id: 'prt_end',
            messageID: 'msg_answer',
            sessionID,
            type: 'text',
            text: 'Тесты проходят. Можно переходить к следующему модулю — или сначала посмотреть изменения.',
          },
        ],
      },
    ],
  };
  questions = [
    {
      id: 'que_auth',
      sessionID: 'ses_auth',
      questions: [
        {
          header: 'Хранение сессий',
          question: 'Где храним пользовательские сессии?',
          options: [
            { label: 'Redis', description: 'Быстрое хранилище с TTL. Удобно для нескольких инстансов.' },
            { label: 'PostgreSQL', description: 'Меньше инфраструктуры, все данные в одной базе.' },
          ],
          custom: true,
        },
        {
          header: 'Возможности',
          question: 'Что включить в первую версию?',
          options: [
            { label: 'OAuth', description: 'Вход через провайдера' },
            { label: 'Passkeys', description: 'Ключи устройства' },
          ],
          multiple: true,
          custom: true,
        },
      ],
    },
  ];
  permissions = [
    {
      id: 'per_build',
      sessionID: 'ses_bcore',
      permission: 'bash',
      patterns: ['cargo test --workspace'],
      always: ['cargo test *'],
      metadata: { description: 'Проверить генератор чанков' },
    },
  ];
}
reset();

function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
function emit(type: string, properties: Record<string, unknown>) {
  const data = { directory, payload: { id: `evt_${++events}`, type, properties } };
  for (const response of output) response.write(`data: ${JSON.stringify(data)}\n\n`);
}
function merge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target };
  for (const [key, value] of Object.entries(patch))
    next[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      next[key] &&
      typeof next[key] === 'object'
        ? merge(next[key] as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  return next;
}

async function startBridge() {
  stateDirectory = await mkdtemp(join(fixtureRoot, 'run-'));
  return createBridge({
    upstream: 'http://127.0.0.1:4097',
    port: 4142,
    stateDirectory,
    name: 'DESKTOP-1337',
    origins: [`http://127.0.0.1:${process.env.OCC_E2E_PORT ?? 1420}`],
    log: console.error,
  });
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost:4097');
    let payload: Record<string, unknown> = {};
    if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      if (text) payload = JSON.parse(text);
    }
    if (url.pathname === '/__test/reset') {
      await bridge.close();
      await rm(stateDirectory, { recursive: true, force: true });
      reset();
      bridge = await startBridge();
      return send(response, true);
    }
    if (url.pathname === '/__test/pair') return send(response, bridge.createPairing());
    if (url.pathname === '/__test/state') return send(response, { config, prompts, replies, providerKeys });
    if (url.pathname === '/__test/event') {
      const type = String(payload.type);
      const properties = payload.properties as Record<string, unknown>;
      if (type === 'message.updated') {
        const info = properties.info as Message;
        const entry = messages[info.sessionID]?.find((item) => item.info.id === info.id);
        if (entry) entry.info = info;
      }
      if (type === 'message.part.updated') {
        const part = properties.part as Part;
        const entry = messages[part.sessionID]?.find((item) => item.info.id === part.messageID);
        if (entry) {
          const index = entry.parts.findIndex((item) => item.id === part.id);
          if (index < 0) entry.parts.push(part);
          else entry.parts[index] = part;
        }
      }
      if (type === 'message.part.delta') {
        const part = messages[String(properties.sessionID)]
          ?.find((entry) => entry.info.id === properties.messageID)
          ?.parts.find((entry) => entry.id === properties.partID);
        if (
          !part ||
          (part.type !== 'text' && part.type !== 'reasoning') ||
          properties.field !== 'text' ||
          typeof properties.delta !== 'string'
        )
          return send(response, { error: 'Invalid text delta' }, 400);
        part.text += properties.delta;
      }
      emit(type, properties);
      return send(response, true);
    }
    if (url.pathname === '/global/health') return send(response, { healthy: true, version: '1.18.34' });
    if (url.pathname === '/global/event') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      response.write('data: {"type":"server.connected","properties":{}}\n\n');
      output.add(response);
      const timer = setInterval(() => response.write(': ping\n\n'), 10000);
      response.on('close', () => {
        output.delete(response);
        clearInterval(timer);
      });
      return;
    }
    if (url.pathname === '/project')
      return send(response, [
        {
          id: 'project',
          name: 'emberdeck',
          worktree: directory,
          time: { created: now, updated: now },
          sandboxes: [],
        },
      ]);
    if (url.pathname === '/provider')
      return send(response, {
        all: [
          {
            id: 'anthropic',
            name: 'Anthropic',
            models: {
              'claude-sonnet-4-6': {
                id: 'claude-sonnet-4-6',
                name: 'Claude Sonnet 4.6',
                limit: { context: 200000, output: 64000 },
                cost: { input: 3, output: 15 },
                capabilities: { reasoning: true, attachment: true },
                variants: { high: {}, low: {} },
              },
              'claude-opus-4-6': {
                id: 'claude-opus-4-6',
                name: 'Claude Opus 4.6',
                limit: { context: 200000, output: 32000 },
                cost: { input: 5, output: 25 },
                capabilities: { reasoning: true, attachment: true },
              },
            },
          },
          {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-5.4': {
                id: 'gpt-5.4',
                name: 'GPT-5.4',
                limit: { context: 272000, output: 128000 },
                cost: { input: 2.5, output: 15 },
                capabilities: { reasoning: true },
                variants: { high: {}, medium: {} },
              },
            },
          },
          {
            id: 'google',
            name: 'Google',
            models: {
              'gemini-3-pro': {
                id: 'gemini-3-pro',
                name: 'Gemini 3 Pro',
                limit: { context: 1000000, output: 64000 },
                cost: { input: 2, output: 12 },
                capabilities: { reasoning: true, attachment: true },
              },
            },
          },
        ],
        connected: ['anthropic', 'openai', 'google'],
        default: { anthropic: 'claude-sonnet-4-6' },
      });
    if (url.pathname === '/agent')
      return send(response, [
        { name: 'build', mode: 'primary', permission: [], options: {} },
        { name: 'plan', mode: 'primary', permission: [], options: {} },
      ]);
    if (url.pathname === '/config' || url.pathname === '/global/config') {
      if (request.method === 'PATCH') config = merge(config, payload) as Config;
      return send(response, config);
    }
    if (url.pathname.startsWith('/auth/') && request.method === 'PUT') {
      providerKeys.push(url.pathname.slice(6));
      return send(response, true);
    }
    if (url.pathname === '/experimental/session') return send(response, sessions);
    if (url.pathname === '/session/status')
      return send(response, { ses_bcore: { type: 'busy' }, ses_plugins: { type: 'busy' } });
    if (url.pathname === '/question' || url.pathname === '/permission')
      return send(response, url.pathname === '/question' ? questions : permissions);
    if (/^\/(question|permission)\/.+\/(reply|reject)$/.test(url.pathname)) {
      const [, kind, id] = url.pathname.split('/');
      replies.push({ kind, id, ...payload });
      questions = questions.filter((item) => item.id !== id);
      permissions = permissions.filter((item) => item.id !== id);
      emit(`${kind}.${url.pathname.endsWith('reject') ? 'rejected' : 'replied'}`, { requestID: id });
      return send(response, true);
    }
    if (url.pathname === '/command')
      return send(response, [
        { name: 'review', description: 'Проверить изменения', template: 'Review $ARGUMENTS' },
      ]);
    if (url.pathname === '/session' && request.method === 'POST') {
      const created: Session = {
        id: `ses_created_${++sequence}`,
        title: String(payload.title ?? 'Новая сессия'),
        directory: url.searchParams.get('directory') ?? directory,
        projectID: 'project',
        slug: `new-${sequence}`,
        version: '1.18.34',
        time: { created: Date.now(), updated: Date.now() },
      };
      sessions.push(created);
      messages[created.id] = [];
      emit('session.created', { info: created });
      return send(response, created);
    }
    const match = url.pathname.match(/^\/session\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const id = match[1]!;
      const action = match[2];
      if (action === 'message') return send(response, messages[id] ?? []);
      if (action === 'diff')
        return send(response, [
          {
            file: 'src/modules/servers/events.ts',
            additions: 4,
            deletions: 1,
            patch:
              '@@ -1,2 +1,5 @@\n-export type Event = string;\n+export interface ServerEvents {\n+  "server.started": { id: string; port: number };\n+  "server.stopped": { id: string; reason: string };\n+}',
          },
        ]);
      if (action === 'todo')
        return send(response, [
          { content: 'Выделить модуль servers', status: 'completed', priority: 'high' },
          { content: 'Добавить типизированные события', status: 'completed', priority: 'high' },
          { content: 'Подключить интерфейс управления', status: 'in_progress', priority: 'medium' },
        ]);
      if (action === 'abort') {
        emit('session.status', { sessionID: id, status: { type: 'idle' } });
        return send(response, true);
      }
      if (action === 'prompt_async' || action === 'command') {
        prompts.push({ ...payload, directory: url.searchParams.get('directory'), sessionID: id });
        const messageID = String(payload.messageID);
        const parts = (payload.parts ?? [
          { type: 'text', text: `/${payload.command} ${payload.arguments}` },
        ]) as { type: 'text'; text: string }[];
        const user: MessageEntry = {
          info: {
            id: messageID,
            sessionID: id,
            role: 'user',
            time: { created: Date.now() },
            agent: String(payload.agent),
            model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
          },
          parts: parts.map((part, index) => ({
            ...part,
            id: `prt_${messageID}_${index}`,
            sessionID: id,
            messageID,
          })),
        };
        messages[id] = [...(messages[id] ?? []), user];
        emit('message.updated', { info: user.info });
        for (const part of user.parts) emit('message.part.updated', { part });
        emit('session.status', { sessionID: id, status: { type: 'busy' } });
        response.writeHead(action === 'prompt_async' ? 204 : 200);
        response.end(action === 'prompt_async' ? undefined : JSON.stringify(user));
        setTimeout(() => {
          const assistantID = `msg_reply_${++sequence}`;
          const answer = 'Готово. Изменения применены, проверка пройдена.';
          const assistant: MessageEntry = {
            info: {
              id: assistantID,
              sessionID: id,
              role: 'assistant',
              time: { created: Date.now(), completed: Date.now() },
              parentID: messageID,
              modelID: 'claude-sonnet-4-6',
              providerID: 'anthropic',
              mode: 'build',
              agent: 'build',
              path: { cwd: directory, root: directory },
              cost: 0.01,
              tokens: { input: 100, output: 40, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            parts: [
              { id: `prt_${assistantID}`, messageID: assistantID, sessionID: id, type: 'text', text: answer },
            ],
          };
          messages[id]!.push(assistant);
          emit('message.updated', { info: assistant.info });
          const part = assistant.parts[0]!;
          emit('message.part.updated', { part: { ...part, text: '' } });
          emit('message.part.delta', {
            sessionID: id,
            messageID: assistantID,
            partID: part.id,
            field: 'text',
            delta: answer,
          });
          emit('session.idle', { sessionID: id });
        }, 120);
        return;
      }
      if (!action && request.method === 'PATCH') {
        const target = sessions.find((item) => item.id === id)!;
        Object.assign(target, payload);
        emit('session.updated', { info: target });
        return send(response, target);
      }
    }
    if (url.pathname === '/file')
      return send(response, [
        { name: 'src', path: 'src', absolute: `${directory}/src`, type: 'directory', ignored: false },
        {
          name: 'README.md',
          path: 'README.md',
          absolute: `${directory}/README.md`,
          type: 'file',
          ignored: false,
        },
      ]);
    if (url.pathname === '/file/content')
      return send(response, { type: 'text', content: '# Emberdeck\nYour servers, under control.\n' });
    send(response, { error: `Fixture route not found: ${request.method} ${url.pathname}` }, 404);
  })().catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) send(response, { error: 'Fixture error' }, 500);
  });
});

await mkdir(fixtureRoot, { recursive: true });
await new Promise<void>((resolve) => server.listen(4097, '127.0.0.1', resolve));
bridge = await startBridge();
console.log('OCC test fixture: upstream 4097 / authenticated companion 4142');
async function close() {
  for (const response of output) response.end();
  await bridge.close();
  await rm(stateDirectory, { recursive: true, force: true });
  server.closeAllConnections();
  server.close();
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
