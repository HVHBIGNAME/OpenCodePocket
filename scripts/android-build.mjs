import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const mode = process.argv[2] ?? 'debug';
const env = { ...process.env };
if (!env.ANDROID_HOME && process.platform === 'win32')
  env.ANDROID_HOME = `${process.env.LOCALAPPDATA}/Android/Sdk`;
if (mode === 'release') {
  const signing = JSON.parse(await readFile('.secrets/android-signing.json', 'utf8'));
  env.OCC_KEYSTORE_FILE = signing.keystore;
  env.OCC_KEYSTORE_PASSWORD = signing.password;
}
const args = [
  mode === 'release' ? 'assembleRelease' : 'assembleDebug',
  '--console=plain',
  '--stacktrace',
  '--no-daemon',
];
const result = spawnSync(
  process.platform === 'win32' ? 'cmd.exe' : './gradlew',
  process.platform === 'win32' ? ['/d', '/s', '/c', 'gradlew.bat', ...args] : args,
  {
    cwd: resolve('android'),
    env,
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  },
);
console.log(result.stdout);
if (result.stderr) console.error(result.stderr);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
