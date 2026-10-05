import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge } from '../../packages/bridge/src/server';
import { DeviceStore, PairingCodes } from '../../packages/bridge/src/state';

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function setup() {
  const root = join(process.cwd(), '.cache', 'unit-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'occ-test-'));
  disposals.push(() => rm(directory, { recursive: true, force: true }));
  const upstream = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Basic local-secret') { response.writeHead(401); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ path: request.url, method: request.method, healthy: true, version: 'test' }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  disposals.push(() => new Promise<void>((resolve) => { upstream.closeAllConnections(); upstream.close(() => resolve()); }));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const bridge = await createBridge({ upstream: `http://127.0.0.1:${address.port}`, upstreamAuthorization: 'Basic local-secret', stateDirectory: directory, port: 0,
    origins: ['http://localhost:1420'], subscribe: false, log: () => undefined });
  disposals.push(() => bridge.close());
  const code = bridge.createPairing();
  const pair = await fetch(`${bridge.localUrl}/occ/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.code, name: 'test phone' }) });
  const credentials = await pair.json() as { token: string; deviceID: string };
  return { bridge, credentials, directory, code, headers: { Authorization: `Bearer ${credentials.token}` } };
}

describe('authenticated bridge', () => {
  it('exchanges a QR once and persists only a hash of the device token', async () => {
    const { bridge, credentials, directory, code } = await setup();
    const repeated = await fetch(`${bridge.localUrl}/occ/pair`, { method: 'POST', body: JSON.stringify({ code: code.code, name: 'attacker' }) });
    expect(repeated.status).toBe(401);
    const disk = await readFile(join(directory, 'devices.json'), 'utf8');
    expect(disk).not.toContain(credentials.token);
    const reopened = new DeviceStore(directory); await reopened.load();
    expect(reopened.authenticate(credentials.token)?.name).toBe('test phone');
  });
  it('proxies path, directory, and upstream auth without sending the device key upstream', async () => {
    const { bridge, headers } = await setup();
    const result = await fetch(`${bridge.localUrl}/api/session?directory=C%3A%5Cmy%20project`, { headers });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ path: '/session?directory=C%3A%5Cmy%20project' });
    expect((await fetch(`${bridge.localUrl}/api/session`)).status).toBe(401);
  });
  it('rejects untrusted browser origins and permits explicit app preflight', async () => {
    const { bridge, headers } = await setup();
    expect((await fetch(`${bridge.localUrl}/api/session`, { headers: { ...headers, Origin: 'https://evil.example' } })).status).toBe(403);
    const preflight = await fetch(`${bridge.localUrl}/api/session`, { method: 'OPTIONS', headers: { Origin: 'capacitor://localhost' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
  });
  it('revokes a device immediately and hides credentials in device listings', async () => {
    const { bridge, headers, credentials } = await setup();
    const list = await (await fetch(`${bridge.localUrl}/occ/devices`, { headers })).json();
    expect(JSON.stringify(list)).not.toContain('token');
    expect((await fetch(`${bridge.localUrl}/occ/devices/${credentials.deviceID}`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(`${bridge.localUrl}/api/session`, { headers })).status).toBe(401);
  });
  it('requires a different local-only control secret to create new pairing codes', async () => {
    const { bridge, headers } = await setup();
    const result = await fetch(`${bridge.localUrl}/occ/local/pair`, { method: 'POST', headers, body: '{}' });
    expect(result.status).toBe(401);
  });
  it('rate-limits brute-force pairing attempts', async () => {
    const { bridge } = await setup();
    let status = 0;
    for (let i = 0; i < 13; i++) status = (await fetch(`${bridge.localUrl}/occ/pair`, { method: 'POST', body: JSON.stringify({ code: 'invalid-but-long-code', name: 'test' }) })).status;
    expect(status).toBe(429);
  });
  it('streams and replays events after Last-Event-ID without exposing the token in URLs', async () => {
    const { bridge, headers } = await setup();
    bridge.relay.publish({ type: 'question.asked', properties: { id: 'one' } });
    const controller = new AbortController();
    const response = await fetch(`${bridge.localUrl}/occ/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    bridge.relay.publish({ type: 'question.asked', properties: { id: 'two' } });
    const frame = new TextDecoder().decode((await reader.read()).value);
    const lastID = frame.match(/id: (.+)/)?.[1];
    expect(lastID).toBeTruthy();
    controller.abort(); await reader.cancel().catch(() => undefined);
    bridge.relay.publish({ type: 'question.asked', properties: { id: 'three' } });
    const resumed = new AbortController();
    const replay = await fetch(`${bridge.localUrl}/occ/events`, { headers: { ...headers, 'Last-Event-ID': lastID! }, signal: resumed.signal });
    const replayReader = replay.body!.getReader();
    const replayText = new TextDecoder().decode((await replayReader.read()).value);
    expect(replayText).toContain('three'); expect(replayText).not.toContain('"two"');
    resumed.abort(); await replayReader.cancel().catch(() => undefined);
  });
});

it('expires pairing codes after ten minutes', () => {
  const codes = new PairingCodes();
  const { code, expires } = codes.create();
  vi.spyOn(Date, 'now').mockReturnValue(expires + 1);
  expect(codes.consume(code)).toBe(false);
});
