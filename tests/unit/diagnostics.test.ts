import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DiagnosticSchema, errorShape, type Diagnostic } from '../../shared/diagnostics';
import { ReportService } from '../../packages/bridge/src/reports';
import {
  attachDiagnosticClient,
  captureDiagnostic,
  diagnosticStatus,
  flushDiagnostics,
  initializeDiagnostics,
  setDiagnosticsEnabled,
} from '../../src/lib/diagnostics';
import { OpenCodeClient } from '../../src/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});
const report = (): Diagnostic => ({
  schema: 1,
  id: randomUUID(),
  timestamp: Date.now(),
  version: '1.0.0',
  platform: 'android',
  kind: 'action',
  severity: 'error',
  name: 'TypeError',
  operation: 'send',
  screen: 'chat',
  frames: ['Composer.tsx:42:10'],
});

describe('redacted automatic reports', () => {
  it('drops error messages, user paths, credentials and hostnames while preserving code locations', () => {
    const error = new Error('secret prompt: sk-private-key. server https://private.example/?token=secret');
    error.stack =
      'Error: private prompt\n    at send (https://private.example/assets/index-123.js:9:21)\n    at capture (C:\\Users\\PRIVATE_USER\\app\\client.ts:3:5)';
    const shape = errorShape(error);
    expect(shape.frames).toEqual(['index-123.js:9:21', 'client.ts:3:5']);
    expect(JSON.stringify(shape)).not.toMatch(/private|PRIVATE|secret|prompt|https/);
    expect(DiagnosticSchema.safeParse({ ...report(), prompt: 'private source' }).success).toBe(false);
  });

  it('keeps reports offline, sends after pairing, and stops collecting on opt-out', async () => {
    await initializeDiagnostics();
    captureDiagnostic(new TypeError('MUST_NEVER_UPLOAD_THIS'), { operation: 'send' });
    expect(diagnosticStatus().queued).toBe(1);
    const received: Diagnostic[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        const batch = JSON.parse(String(options.body)) as { reports: Diagnostic[] };
        received.push(...batch.reports);
        return new Response(JSON.stringify({ accepted: batch.reports.map((item) => item.id) }), {
          status: 200,
        });
      }),
    );
    attachDiagnosticClient(
      new OpenCodeClient({
        id: 'test',
        name: 'test',
        url: 'http://127.0.0.1:4142',
        mode: 'bridge',
        credential: 'only-test',
      }),
    );
    await flushDiagnostics();
    expect(diagnosticStatus().queued).toBe(0);
    expect(received).toHaveLength(1);
    expect(JSON.stringify(received)).not.toContain('MUST_NEVER_UPLOAD_THIS');
    await setDiagnosticsEnabled(false);
    captureDiagnostic(new Error('disabled'));
    expect(diagnosticStatus().queued).toBe(0);
    attachDiagnosticClient(undefined);
  });

  it('persists, deduplicates retries, and creates one GitHub issue for a repeated failure', async () => {
    const root = join(process.cwd(), '.cache', 'report-tests');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'case-'));
    const created: Record<string, unknown>[] = [];
    const github = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.includes('/labels')) {
        response.end('{}');
        return;
      }
      if (request.method === 'GET') {
        response.end('[]');
        return;
      }
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.from(chunk));
      created.push(JSON.parse(Buffer.concat(buffers).toString()));
      response.end(JSON.stringify({ number: 7, html_url: 'https://github.com/test/occ/issues/7' }));
    });
    await new Promise<void>((resolve) => github.listen(0, '127.0.0.1', resolve));
    const address = github.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const options = {
      github: true,
      repository: 'test/occ',
      token: 'TEST',
      useGhCli: false,
      apiBase: `http://127.0.0.1:${address.port}`,
    };
    const service = new ReportService(directory, options, () => undefined);
    try {
      await service.load();
      const first = report();
      const second = report();
      await service.accept('device', [first, first, second]);
      await service.flush();
      expect(created).toHaveLength(1);
      expect(service.summary().reports[0]).toMatchObject({
        count: 2,
        issueURL: 'https://github.com/test/occ/issues/7',
      });
      await service.accept('device', [first]);
      await service.flush();
      expect(created).toHaveLength(1);
      await service.close();
      const reopened = new ReportService(directory, options, () => undefined);
      await reopened.load();
      expect(reopened.summary().reports[0]?.count).toBe(2);
      await reopened.close();
    } finally {
      await service.close();
      github.closeAllConnections();
      await new Promise<void>((resolve) => github.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
