import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { installCommands, installedCommands, pocketCommands } from '../../packages/bridge/src/commands';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('quotes Windows runtime paths and never prints pairing secrets or executes user arguments', () => {
  const commands = pocketCommands(
    "C:\\Program Files\\O'Brien\\node.exe",
    'C:\\Пользователь\\cli.mjs',
    'win32',
  );
  const encoded = commands['pocket-qr'].template.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1]!;
  expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(
    "& 'C:\\Program Files\\O''Brien\\node.exe' 'C:\\Пользователь\\cli.mjs' pair --quiet",
  );
  const config = commands['pocket-config'].template;
  expect(config).toContain('$ARGUMENTS');
  expect(config.match(/!`([^`]+)`/)![1]).not.toContain('$ARGUMENTS');
  expect(
    pocketCommands('/usr/local/bin/node', "/home/o'brien/cli.mjs", 'linux')['pocket-status'].template,
  ).toContain("'/home/o'\\''brien/cli.mjs' status");
});

it('installs idempotent command files and preserves a user-owned command', async () => {
  const root = join(process.cwd(), '.cache', 'commands-tests');
  await mkdir(root, { recursive: true });
  const home = await mkdtemp(join(root, 'run-'));
  directories.push(home);
  const state = join(home, 'occ-pocket');
  await mkdir(state);
  await installCommands(home, state);
  const first = await readFile(join(home, 'commands', 'pocket-qr.md'), 'utf8');
  await installCommands(home, state);
  expect(await readFile(join(home, 'commands', 'pocket-qr.md'), 'utf8')).toBe(first);
  expect(await installedCommands(state)).toEqual(pocketCommands(process.execPath, join(state, 'cli.mjs')));
  await writeFile(join(home, 'commands', 'pocket.md'), 'My own command');
  await expect(installCommands(home, state)).rejects.toThrow('was not overwritten');
  expect(await readFile(join(home, 'commands', 'pocket.md'), 'utf8')).toBe('My own command');
});
