import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { APP_VERSION, normalizeServerUrl, pairingLink } from '../../../shared/protocol';
import { atomicJson, DeviceStore, equalSecret, PairingCodes, secret } from './state';
import { EventRelay } from './events';
import { PushService, type PushOptions } from './push';
import { DiagnosticBatchSchema } from '../../../shared/diagnostics';
import { ReportService } from './reports';
import type { ReportOptions } from './github-reports';

export type BridgeOptions = {
  upstream: string;
  stateDirectory: string;
  port?: number;
  hostname?: string;
  name?: string;
  publicUrl?: string;
  upstreamAuthorization?: string;
  origins?: string[];
  push?: PushOptions;
  subscribe?: boolean;
  log?: (message: string) => void;
  reports?: ReportOptions;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const pairBody = z.object({ code: z.string().min(12).max(128), name: z.string().trim().min(1).max(100) });
const pushBody = z.object({ token: z.string().regex(/^[0-9a-f]{64,200}$/i) });
const permittedRoots = new Set([
  'global',
  'project',
  'path',
  'vcs',
  'config',
  'provider',
  'session',
  'question',
  'permission',
  'agent',
  'command',
  'file',
  'find',
  'mcp',
  'lsp',
  'formatter',
  'auth',
  'experimental',
  'v2',
]);

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage, limit = 16 * 1024 * 1024): Promise<Buffer> {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'Request is too large');
    buffers.push(buffer);
  }
  return Buffer.concat(buffers);
}

export async function createBridge(options: BridgeOptions) {
  const upstream = normalizeServerUrl(options.upstream);
  const log = options.log ?? console.error;
  const devices = new DeviceStore(options.stateDirectory);
  await devices.load();
  const reports = new ReportService(
    options.stateDirectory,
    options.reports ?? { github: false, repository: 'HVHBIGNAME/OpenCodePocket' },
    log,
  );
  await reports.load();
  const codes = new PairingCodes();
  const controlToken = secret();
  const push = new PushService(options.push ?? {}, devices, log);
  const relay = new EventRelay((event) => {
    void push.dispatch(event).catch((error: unknown) => log(String(error)));
  });
  const origins = new Set([
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    ...(options.origins ?? []),
  ]);
  const attempts = new Map<string, { count: number; reset: number }>();
  let publicUrl = options.publicUrl ? normalizeServerUrl(options.publicUrl) : '';

  const createPairing = (url = publicUrl) => {
    if (!url) throw new HttpError(409, 'Specify a public HTTPS URL or a LAN address first');
    const pairing = {
      ...codes.create(),
      url: normalizeServerUrl(url),
      name: options.name ?? 'My workstation',
    };
    return { ...pairing, link: pairingLink(pairing) };
  };

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    void handle(request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) return json(response, error.status, { error: error.message });
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return json(response, 400, { error: 'Invalid request body' });
      log(`Request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      json(response, 502, { error: 'OpenCode is unavailable. Check the server on your computer.' });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new HttpError(403, 'Origin not allowed');
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Last-Event-ID, X-OpenCode-Directory',
        'Access-Control-Max-Age': '600',
      });
      return response.end();
    }
    const rawPath = request.url ?? '/';
    if (rawPath.includes('\\') || /%2e|%2f|%5c|\/\.\./i.test(rawPath.split('?')[0]!))
      throw new HttpError(400, 'Invalid path');
    const url = new URL(rawPath, 'http://bridge.local');
    if (url.pathname === '/healthz' && request.method === 'GET')
      return json(response, 200, { name: 'OpenCodePocket', version: APP_VERSION });
    if (url.pathname === '/occ/local/pair' && request.method === 'POST') {
      if (!equalSecret(String(request.headers['x-occ-control'] ?? ''), controlToken))
        throw new HttpError(401, 'Invalid control token');
      const input = z
        .object({ url: z.string().optional() })
        .parse(JSON.parse((await body(request, 4096)).toString()));
      return json(response, 200, createPairing(input.url));
    }
    if (url.pathname === '/occ/pair' && request.method === 'POST') {
      const address = request.socket.remoteAddress ?? 'unknown';
      const previous = attempts.get(address);
      const attempt =
        previous && previous.reset > Date.now() ? previous : { count: 0, reset: Date.now() + 60_000 };
      if (++attempt.count > 12) throw new HttpError(429, 'Too many pairing attempts. Wait one minute.');
      attempts.set(address, attempt);
      if (attempts.size > 1024) attempts.delete(attempts.keys().next().value!);
      const input = pairBody.parse(JSON.parse((await body(request, 4096)).toString()));
      if (!codes.consume(input.code))
        throw new HttpError(401, 'Pairing code expired or already used. Generate a new QR on your computer.');
      const paired = await devices.pair(input.name);
      return json(response, 200, { ...paired, name: options.name ?? 'My workstation', version: APP_VERSION });
    }

    const authorization = request.headers.authorization ?? '';
    const device = authorization.startsWith('Bearer ')
      ? devices.authenticate(authorization.slice(7))
      : undefined;
    if (!device) throw new HttpError(401, 'Pair this device first');
    if (url.pathname === '/occ/info' && request.method === 'GET')
      return json(response, 200, {
        version: APP_VERSION,
        name: options.name ?? 'My workstation',
        online: relay.online,
        push: { apns: Boolean(options.push?.apns), ntfy: Boolean(options.push?.ntfy) },
        deviceID: device.id,
        reports: { github: reports.options.github, repository: reports.options.repository },
      });
    if (url.pathname === '/occ/events' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      relay.attach(
        response,
        device.id,
        typeof request.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : undefined,
      );
      return;
    }
    if (url.pathname === '/occ/devices' && request.method === 'GET')
      return json(
        response,
        200,
        devices.devices.map(({ id, name, created }) => ({ id, name, created, current: id === device.id })),
      );
    if (url.pathname === '/occ/reports' && request.method === 'GET')
      return json(response, 200, reports.summary());
    if (url.pathname === '/occ/reports' && request.method === 'POST') {
      const input = DiagnosticBatchSchema.parse(JSON.parse((await body(request, 64 * 1024)).toString()));
      return json(response, 200, { accepted: await reports.accept(device.id, input.reports) });
    }
    if (/^\/occ\/devices\/[a-f0-9]+$/.test(url.pathname) && request.method === 'DELETE') {
      const id = url.pathname.split('/').pop()!;
      await devices.revoke(id);
      relay.revoke(id);
      return json(response, 200, true);
    }
    if (url.pathname === '/occ/push' && request.method === 'POST') {
      if (!options.push?.apns) throw new HttpError(409, 'APNs is not configured on this bridge');
      const input = pushBody.parse(JSON.parse((await body(request, 4096)).toString()));
      await devices.setPush(device.id, input.token);
      return json(response, 200, true);
    }
    if (url.pathname === '/occ/push' && request.method === 'DELETE') {
      await devices.setPush(device.id);
      return json(response, 200, true);
    }
    if (url.pathname === '/occ/notifications/test' && request.method === 'POST') {
      await push.dispatch({ type: 'question.asked', properties: {} });
      return json(response, 200, { dispatched: Boolean(options.push?.apns || options.push?.ntfy) });
    }
    if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found');
    const path = url.pathname.slice(4);
    if (!permittedRoots.has(path.split('/')[1] ?? '') || path.startsWith('//'))
      throw new HttpError(404, 'Unknown API endpoint');
    if (path === '/global/event' || path === '/event')
      throw new HttpError(400, 'Use /occ/events for streaming');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.upstreamAuthorization) headers.Authorization = options.upstreamAuthorization;
    if (request.headers['content-type']) headers['Content-Type'] = request.headers['content-type'];
    const requestBody = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : await body(request);
    const target = `${upstream}${path}${url.search}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120_000);
    const disconnect = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.on('close', disconnect);
    try {
      const result = await fetch(target, {
        method: request.method,
        headers,
        body: requestBody ? new Uint8Array(requestBody) : undefined,
        signal: abort.signal,
        redirect: 'manual',
      });
      if (result.status >= 300 && result.status < 400)
        throw new HttpError(502, 'Unexpected upstream redirect');
      response.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') ?? 'application/json',
      });
      if (result.body) await pipeline(Readable.from(result.body), response);
      else response.end();
    } finally {
      clearTimeout(timer);
      response.removeListener('close', disconnect);
    }
  }

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4141, options.hostname ?? '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Bridge did not bind a TCP port');
  const localUrl = `http://127.0.0.1:${address.port}`;
  if (!publicUrl) publicUrl = localUrl;
  await atomicJson(join(options.stateDirectory, 'runtime.json'), {
    pid: process.pid,
    url: localUrl,
    controlToken,
    publicUrl,
  });
  if (options.subscribe !== false)
    void relay.subscribe(`${upstream}/global/event`, options.upstreamAuthorization);
  return {
    server,
    relay,
    devices,
    reports,
    localUrl,
    createPairing,
    setPublicUrl: (value: string) => {
      publicUrl = normalizeServerUrl(value);
    },
    async close() {
      relay.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await reports.close();
    },
  };
}
