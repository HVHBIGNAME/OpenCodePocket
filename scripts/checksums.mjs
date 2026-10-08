import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'artifacts';
const files = (await readdir(directory))
  .filter((name) => /\.(apk|ipa|tgz|mjs|cmd|ps1|sh)$/.test(name))
  .sort();
for (const extension of ['apk', 'ipa', 'tgz']) {
  if (files.filter((name) => name.endsWith(`.${extension}`)).length !== 1)
    throw new Error(`Expected exactly one ${extension} release artifact.`);
}
for (const name of [
  'occ-pocket-cli.mjs',
  'occ-pocket-plugin.mjs',
  'occ-pocket-tui.mjs',
  'Install-Pocket.cmd',
  'install-pocket.ps1',
  'install-pocket.sh',
]) {
  if (!files.includes(name)) throw new Error(`Missing installer asset: ${name}`);
}
const lines = await Promise.all(
  files.map(
    async (name) =>
      `${createHash('sha256')
        .update(await readFile(join(directory, name)))
        .digest('hex')}  ${name}`,
  ),
);
await writeFile(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
