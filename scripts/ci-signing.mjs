import { access, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.ANDROID_KEYSTORE_BASE64 || !process.env.OCC_KEYSTORE_PASSWORD)
  throw new Error(
    'Configure ANDROID_KEYSTORE_BASE64 and ANDROID_KEYSTORE_PASSWORD repository secrets before building.',
  );
const directory = process.env.RUNNER_TEMP;
if (!directory || !process.env.GITHUB_ENV) throw new Error('This helper runs in GitHub Actions.');
await access(directory);
const path = join(directory, 'occ-release.keystore');
await writeFile(path, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'), { mode: 0o600 });
await appendFile(process.env.GITHUB_ENV, `OCC_KEYSTORE_FILE=${path}\n`);
console.log('Release signing identity loaded.');
