import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('packages/bridge/dist', { recursive: true });
await build({
  entryPoints: [
    'packages/bridge/src/cli.ts',
    'packages/bridge/src/plugin.ts',
    'packages/bridge/src/server.ts',
  ],
  outdir: 'packages/bridge/dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  banner: {
    js: 'import { createRequire as __occCreateRequire } from "node:module"; const require = __occCreateRequire(import.meta.url);',
  },
});
await copyFile('LICENSE', 'packages/bridge/LICENSE');
