import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const revision = '3f393d78bfc3f0826b2c7080e57964c235704695';
const base = `https://raw.githubusercontent.com/anomalyco/opencode/${revision}`;
const vendor = 'third_party/opencode';
const check = process.argv.includes('--check');
const offline = check || process.argv.includes('--offline');
const files = [
  'types.ts',
  'color.ts',
  'resolve.ts',
  'default-themes.ts',
  'v2/resolve.ts',
  'v2/mapping.ts',
  'v2/default-primitives.ts',
  'v2/foreground.ts',
  'v2/avatar.ts',
];
async function source(path, destination) {
  if (offline) return readFile(destination, 'utf8');
  const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const text = await response.text();
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, text);
  return text;
}
await source('LICENSE', `${vendor}/LICENSE`);
for (const file of files) await source(`packages/ui/src/theme/${file}`, `${vendor}/theme/${file}`);
const defaults = await readFile(`${vendor}/theme/default-themes.ts`, 'utf8');
const ids = [...defaults.matchAll(/from "\.\/themes\/([a-z0-9-]+)\.json"/g)].map((match) => match[1]).sort();
if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Invalid upstream theme catalog');
const themes = [];
for (let i = 0; i < ids.length; i += 6) {
  themes.push(
    ...(await Promise.all(
      ids.slice(i, i + 6).map(async (id) => {
        const path = `theme/themes/${id}.json`;
        const text = await source(`packages/ui/src/${path}`, `${vendor}/${path}`);
        const theme = JSON.parse(text);
        if (theme.id !== id || !theme.name || !theme.light || !theme.dark)
          throw new Error(`Invalid theme: ${id}`);
        return { theme, hash: createHash('sha256').update(text).digest('hex') };
      }),
    )),
  );
}
await mkdir('.cache/theme-build', { recursive: true });
const output = resolve('.cache/theme-build/resolve.mjs');
await build({
  stdin: {
    contents: `export { resolveThemeVariant } from './${vendor}/theme/resolve.ts'; export { resolveThemeVariantV2 } from './${vendor}/theme/v2/resolve.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: output,
});
const { resolveThemeVariant, resolveThemeVariantV2 } = await import(pathToFileURL(output).href);
const catalog = themes.map(({ theme }) => ({
  id: theme.id,
  name: theme.name,
  light: { ...resolveThemeVariant(theme.light, false), ...resolveThemeVariantV2(theme.light, false) },
  dark: { ...resolveThemeVariant(theme.dark, true), ...resolveThemeVariantV2(theme.dark, true) },
}));
const generated = JSON.stringify({ revision, themes: catalog }, null, 2) + '\n';
if (check) {
  if ((await readFile('src/themes/catalog.json', 'utf8')) !== generated)
    throw new Error('Theme catalog differs from the pinned OpenCode sources');
} else {
  await mkdir('src/themes', { recursive: true });
  await writeFile('src/themes/catalog.json', generated);
  await writeFile(
    `${vendor}/SOURCE.json`,
    JSON.stringify(
      {
        repository: 'https://github.com/anomalyco/opencode',
        revision,
        files: Object.fromEntries(themes.map(({ theme, hash }) => [`theme/themes/${theme.id}.json`, hash])),
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(
  `${check ? 'Verified' : 'Generated'} ${catalog.length} original OpenCode themes, light + dark, using both upstream resolvers (${revision}).`,
);
