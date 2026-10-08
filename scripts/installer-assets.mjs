import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'artifacts/installer';
await mkdir(directory, { recursive: true });
for (const [source, destination] of [
  ['packages/bridge/dist/cli.js', 'occ-pocket-cli.mjs'],
  ['packages/bridge/dist/plugin.js', 'occ-pocket-plugin.mjs'],
  ['packages/bridge/dist/tui.js', 'occ-pocket-tui.mjs'],
  ['scripts/Install-Pocket.cmd', 'Install-Pocket.cmd'],
  ['scripts/install-pocket.ps1', 'install-pocket.ps1'],
  ['scripts/install-pocket.sh', 'install-pocket.sh'],
])
  await copyFile(source, join(directory, destination));
