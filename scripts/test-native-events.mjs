import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve('.cache/native-events');
await mkdir(directory, { recursive: true });
function run(name, args) {
  const executable = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name) : name;
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr}\n${result.stdout}`);
  if (result.stdout) process.stdout.write(result.stdout);
}
run('javac', [
  '--release',
  '17',
  '--add-modules',
  'jdk.httpserver',
  '-encoding',
  'UTF-8',
  '-d',
  directory,
  'android/app/src/main/java/dev/hvhbigname/occ/EventConnection.java',
  'tests/native/EventConnectionTest.java',
]);
run('java', ['--add-modules', 'jdk.httpserver', '-cp', directory, 'dev.hvhbigname.occ.EventConnectionTest']);
