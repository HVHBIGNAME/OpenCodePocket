import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const executable =
  process.env.OCC_OPENCODE_BIN ??
  (process.platform === 'win32'
    ? join(process.env.APPDATA, 'npm/node_modules/opencode-ai/bin/opencode.exe')
    : 'opencode');
const root = resolve('.cache', `live-opencode-${Date.now()}`);
const project = join(root, 'project');
const configDir = join(root, 'config', 'opencode');
const state = join(configDir, 'occ-pocket');
for (const directory of [project, configDir, state, join(root, 'cache'), join(root, 'data')])
  await mkdir(directory, { recursive: true });
await writeFile(
  join(configDir, 'opencode.json'),
  JSON.stringify({ $schema: 'https://opencode.ai/config.json', autoupdate: false }),
);
const password = randomBytes(24).toString('base64url');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(root, 'config'),
  XDG_DATA_HOME: join(root, 'data'),
  XDG_CACHE_HOME: join(root, 'cache'),
  XDG_STATE_HOME: join(root, 'state'),
  OCC_STATE_DIR: state,
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_SERVER_USERNAME: 'opencode',
};
delete env.OPENCODE_CONFIG_CONTENT;
delete env.OPENCODE_CONFIG;
delete env.OPENCODE_CONFIG_DIR;
delete env.OPENCODE_PURE;
const installer = spawnSync(
  process.execPath,
  ['packages/bridge/dist/cli.js', 'install', '--port', '4145', '--url', 'http://127.0.0.1:4145'],
  { env, encoding: 'utf8', timeout: 15000 },
);
if (installer.status !== 0) throw new Error(installer.stderr || 'Plugin installer failed');
const logs = [];
const child = spawn(
  executable,
  ['--print-logs', '--log-level', 'DEBUG', 'serve', '--hostname', '127.0.0.1', '--port', '4098'],
  { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(path, options = {}, bridge = false) {
  const response = await fetch(`${bridge ? 'http://127.0.0.1:4145' : 'http://127.0.0.1:4098'}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: auth, ...options.headers },
    signal: AbortSignal.timeout(90000),
  });
  if (!response.ok)
    throw new Error(`${path}: HTTP ${response.status} ${(await response.text()).slice(0, 400)}`);
  return response.status === 204 ? undefined : response.json();
}
try {
  let health;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`OpenCode exited: ${logs.join('').slice(-3000)}`);
    try {
      health = await request('/global/health');
      break;
    } catch {
      await wait(1000);
    }
  }
  assert(health?.healthy, 'OpenCode did not start');
  console.log(`Live OpenCode ${health.version}: healthy, isolated data/config directories`);
  const session = await request('/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'OCC live integration QA' }),
  });
  assert(session.id);
  const runtime = JSON.parse(await readFile(join(state, 'runtime.json'), 'utf8'));
  const pair = await request(
    '/occ/local/pair',
    { method: 'POST', headers: { 'X-OCC-Control': runtime.controlToken }, body: '{}' },
    true,
  );
  const device = await request(
    '/occ/pair',
    { method: 'POST', body: JSON.stringify({ code: pair.code, name: 'Live QA phone' }) },
    true,
  );
  const headers = { Authorization: `Bearer ${device.token}` };
  const sessions = await request('/api/experimental/session?limit=200', { headers }, true);
  assert(sessions.some((item) => item.id === session.id));
  for (const endpoint of [
    '/api/project',
    '/api/provider',
    '/api/agent',
    '/api/config',
    '/api/question',
    '/api/permission',
    '/api/session/status',
    `/api/session/${session.id}/message`,
  ]) {
    await request(endpoint, { headers }, true);
  }
  console.log(
    'PASS installed plugin, real server authentication, pairing, session/provider/agent/config/question/permission APIs',
  );
  await request(
    '/api/global/config',
    { method: 'PATCH', headers, body: JSON.stringify({ permission: { bash: 'ask', edit: 'ask' } }) },
    true,
  );
  await request('/api/agent', { headers }, true);
  const restored = await request('/api/config', { headers }, true);
  assert.equal(restored.permission.bash, 'ask');
  const info = await request('/occ/info', { headers }, true);
  assert.equal(info.deviceID, device.deviceID);
  console.log('PASS real OpenCode config PATCH, plugin reload handoff and unchanged device access');
  console.log('No AI/provider requests were made.');
} catch (error) {
  await writeFile(join(root, 'server.log'), logs.join('').replaceAll(password, '[REDACTED]'));
  console.error(`Isolated server log: ${join(root, 'server.log')}`);
  throw error;
} finally {
  child.kill();
  await wait(500);
}
