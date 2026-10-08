import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser/lib/esm/main.js';

async function configFile(home: string, name: string) {
  for (const extension of ['jsonc', 'json']) {
    const path = join(home, `${name}.${extension}`);
    try {
      return { path, text: await readFile(path, 'utf8'), exists: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { path: join(home, `${name}.json`), text: '{}\n', exists: false };
}

export async function configureOpenCode(home: string, tui: string) {
  const changes: { path: string; text: string; exists: boolean }[] = [];
  for (const name of ['opencode', 'tui']) {
    const file = await configFile(home, name);
    const errors: ParseError[] = [];
    const config = parse(file.text, errors, { allowTrailingComma: true }) as Record<string, unknown>;
    if (errors.length || !config || typeof config !== 'object' || Array.isArray(config))
      throw new Error(`Invalid ${file.path}; configuration was not overwritten`);
    let text = file.text;
    const set = (path: (string | number)[], value: unknown) => {
      text = applyEdits(
        text,
        modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
      );
    };
    if (!config.$schema) set(['$schema'], `https://opencode.ai/${name === 'tui' ? 'tui' : 'config'}.json`);
    if (name === 'opencode') {
      const server = config.server as { port?: number } | undefined;
      if (server?.port === undefined) set(['server', 'port'], 4096);
    } else {
      if (config.plugin !== undefined && !Array.isArray(config.plugin))
        throw new Error(`Invalid plugin list in ${file.path}`);
      const plugins = (config.plugin ?? []) as unknown[];
      const url = pathToFileURL(tui).href;
      if (!plugins.some((entry) => (Array.isArray(entry) ? entry[0] : entry) === url))
        set(['plugin'], [...plugins, url]);
    }
    if (text !== file.text) {
      changes.push({ ...file, text });
    }
  }
  for (const file of changes) {
    if (file.exists) await copyFile(file.path, `${file.path}.occ-backup`);
    await writeFile(file.path, file.text, { mode: 0o600 });
  }
}
