import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2] ?? 'artifacts';
const files = (await readdir(directory)).filter((name) => /\.(apk|ipa|tgz)$/.test(name)).sort();
if (files.length !== 3)
  throw new Error(`Expected APK, IPA, and bridge package; found ${files.length} artifacts.`);
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
