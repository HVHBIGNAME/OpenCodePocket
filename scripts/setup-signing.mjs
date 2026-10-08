import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = resolve('.secrets');
await mkdir(directory, { recursive: true, mode: 0o700 });
const metadataPath = join(directory, 'android-signing.json');
const keystore = join(directory, 'occ-release.keystore');
let password;
try {
  password = JSON.parse(await readFile(metadataPath, 'utf8')).password;
  await access(keystore);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try {
    await access(keystore);
    throw new Error(
      'Keystore exists but its password file is missing. Restore it instead of replacing the signing identity.',
    );
  } catch (failure) {
    if (failure.code !== 'ENOENT') throw failure;
  }
  password = randomBytes(36).toString('base64url');
  const result = spawnSync(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storetype',
      'PKCS12',
      '-alias',
      'occ',
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-validity',
      '10000',
      '-dname',
      'CN=OpenCode Pocket, O=HVHBIGNAME',
      '-storepass:env',
      'OCC_SIGNING_PASSWORD',
      '-keypass:env',
      'OCC_SIGNING_PASSWORD',
    ],
    { env: { ...process.env, OCC_SIGNING_PASSWORD: password }, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'keytool failed');
  await writeFile(metadataPath, JSON.stringify({ password, alias: 'occ', keystore }, null, 2), {
    mode: 0o600,
  });
}
for (const [name, value] of Object.entries({
  ANDROID_KEYSTORE_BASE64: (await readFile(keystore)).toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: password,
})) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', 'HVHBIGNAME/OpenCodePocket'], {
    input: value,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'GitHub secret upload failed');
}
console.log(
  'Android release identity created/reused. Two encrypted GitHub Actions secrets installed. Keep .secrets/ backed up privately.',
);
