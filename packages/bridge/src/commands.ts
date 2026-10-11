import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function shellCommand(node: string, cli: string, args: string, platform: string) {
  if (platform === 'win32') {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const script = `& ${quote(node)} ${quote(cli)} ${args}`;
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  }
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `${quote(node)} ${quote(cli)} ${args}`;
}

export function pocketCommands(node: string, cli: string, platform = process.platform) {
  const command = (description: string, args: string, after = '') => ({
    description,
    template: `Результат локальной команды OpenCode Pocket:\n\n!\`${shellCommand(node, cli, args, platform)}\`\n\nКратко сообщи результат. ${after}`,
  });
  return {
    pocket: command(
      'Pocket: подключение и настройки',
      'status',
      'Для нового QR доступна /pocket-qr, для настроек /pocket-config.',
    ),
    'pocket-qr': command('Pocket: открыть QR на компьютере', 'pair --quiet'),
    'pocket-status': command('Pocket: состояние подключения', 'status'),
    'pocket-config': command(
      'Pocket: настройки подключения',
      'config',
      'Запрошенные изменения: $ARGUMENTS. Для их сохранения используй pocket_manage только при явном запросе пользователя.',
    ),
  };
}

const marker = '<!-- OpenCode Pocket managed command -->';
export async function installCommands(home: string, state: string, node = process.execPath) {
  const directory = join(home, 'commands');
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(pocketCommands(node, join(state, 'cli.mjs')))) {
    const file = join(directory, `${name}.md`);
    let previous = '';
    try {
      previous = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous && !previous.includes(marker))
      throw new Error(`Command ${file} already exists and was not overwritten`);
    await writeFile(
      file,
      `---\ndescription: ${JSON.stringify(value.description)}\n---\n${marker}\n${value.template}\n`,
      { mode: 0o600 },
    );
  }
  await writeFile(join(state, 'command-runtime.json'), JSON.stringify({ node }), { mode: 0o600 });
}

export async function installedCommands(state: string) {
  let node = 'node';
  try {
    const value: unknown = JSON.parse(await readFile(join(state, 'command-runtime.json'), 'utf8'));
    if (value && typeof value === 'object' && 'node' in value && typeof value.node === 'string')
      node = value.node;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return pocketCommands(node, join(state, 'cli.mjs'));
}
