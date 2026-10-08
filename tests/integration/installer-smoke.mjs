import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'jsonc-parser';

const root = resolve('.cache/installer-smoke');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'run-'));
const config = join(directory, 'config');
const state = join(config, 'occ-pocket');
await mkdir(state, { recursive: true });
await writeFile(
  join(state, 'bridge.json'),
  JSON.stringify({ tunnel: false, publicUrl: 'http://127.0.0.1:4190' }),
);
await writeFile(
  join(config, 'opencode.jsonc'),
  '{\n// Keep this comment\n"server":{"port":4098},"plugin":["existing-plugin"]\n}',
);
const assets = new Map();
for (const name of await readdir('artifacts/installer'))
  assets.set(name, await readFile(join('artifacts/installer', name)));
assets.set(
  'SHA256SUMS.txt',
  Buffer.from(
    [...assets]
      .map(([name, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
      .join('\n') + '\n',
  ),
);
const server = createServer((request, response) => {
  const payload = assets.get((request.url ?? '/').slice(1));
  response.writeHead(payload ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
  response.end(payload ?? 'Not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env, OPENCODE_CONFIG_DIR: config, OCC_STATE_DIR: state, OCC_RELEASE_URL: base };
if (process.argv.includes('--minimal-powershell')) env.PSModulePath = '';
if (process.argv.includes('--without-node') && process.platform === 'win32') {
  env.PATH = `${process.env.SystemRoot}/System32;${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0`;
  delete env.Path;
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(`Installer exited ${code}: ${output}`));
    });
  });
}
try {
  const command = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const args =
    process.platform === 'win32'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/install-pocket.ps1', '-BaseUrl', base]
      : ['scripts/install-pocket.sh'];
  await run(command, args);
  await run(command, args);
  const content = await readFile(join(config, 'opencode.jsonc'), 'utf8');
  assert(content.includes('// Keep this comment'));
  assert.equal(parse(content).server.port, 4098);
  assert.deepEqual(parse(content).plugin, ['existing-plugin']);
  assert.equal(JSON.parse(await readFile(join(config, 'tui.json'), 'utf8')).plugin.length, 1);
  const plugin = await readFile(join(config, 'plugins/occ-pocket.js'), 'utf8');
  assert(plugin.includes('pocket_manage'));
  assert(plugin.includes('pocket-qr'));
  const result = await run(process.execPath, [join(state, 'cli.mjs'), 'config']);
  assert.equal(JSON.parse(result).tunnel, false);
  const payload = assets.get('occ-pocket-plugin.mjs');
  assets.set('occ-pocket-plugin.mjs', Buffer.from('corrupted executable'));
  await assert.rejects(run(command, args), /Checksum mismatch/);
  assert.equal(await readFile(join(config, 'plugins/occ-pocket.js'), 'utf8'), plugin);
  assets.set('occ-pocket-plugin.mjs', payload);
  console.log(
    'PASS bootstrap install/update, checksums, independent CLI, JSONC preservation, OpenCode commands and TUI registration',
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
