import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { displayPairing, readSettings, saveSettings, SettingsSchema, stateHome } from './setup';

export const ManagementSchema = z.object({
  action: z.enum(['qr', 'status', 'settings', 'configure']),
  mode: z.enum(['tunnel', 'lan', 'custom']).optional(),
  url: z.string().optional(),
  name: z.string().min(1).max(100).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  reportsGithub: z.boolean().optional(),
});
export type ManagementInput = z.infer<typeof ManagementSchema>;

export async function localRequest(path: string, data?: unknown) {
  let runtime;
  try {
    runtime = z
      .object({ url: z.string().url(), controlToken: z.string().min(1) })
      .parse(JSON.parse(await readFile(join(stateHome(), 'runtime.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('OCC is not running. Restart OpenCode after installing the plugin.');
    throw error;
  }
  const url = new URL(runtime.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Invalid local OCC control address');
  const response = await fetch(`${runtime.url}/occ/local/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OCC-Control': runtime.controlToken },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(z.object({ error: z.string() }).parse(body).error);
  return body;
}

export function openPairingPage(path: string) {
  return new Promise<void>((resolve, reject) => {
    const command =
      process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [process.platform === 'win32' ? path : pathToFileURL(path).href], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function requestPairing(open = true, terminal = false, url?: string) {
  const pair = z
    .object({ link: z.string(), url: z.string(), name: z.string(), expires: z.number() })
    .parse(await localRequest('pair', { url }));
  const page = await displayPairing(pair, terminal);
  if (open) {
    try {
      await openPairingPage(page);
    } catch {
      return {
        page,
        expires: pair.expires,
        message: 'Open the QR page manually; no browser launcher is available.',
      };
    }
  }
  return {
    page,
    expires: pair.expires,
    message: open ? 'QR page opened on the computer. Scan it in OCC.' : 'QR page created.',
  };
}

export async function managePocket(input: ManagementInput, open = true) {
  input = ManagementSchema.parse(input);
  if (input.action === 'qr') return requestPairing(open);
  if (input.action === 'status') return localRequest('status');
  const saved = await readSettings();
  if (input.action === 'settings') return saved;
  const settings = SettingsSchema.parse({
    ...saved,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.port !== undefined ? { port: input.port } : {}),
    ...(input.reportsGithub !== undefined ? { reportsGithub: input.reportsGithub } : {}),
    ...(input.mode === 'tunnel' ? { tunnel: true, hostname: '127.0.0.1', publicUrl: undefined } : {}),
    ...(input.mode === 'lan' ? { tunnel: false, hostname: '0.0.0.0', publicUrl: undefined } : {}),
    ...(input.mode === 'custom' ? { tunnel: false, hostname: '127.0.0.1', publicUrl: input.url } : {}),
  });
  if (input.mode === 'custom' && !input.url) throw new Error('Specify the HTTPS tunnel URL');
  await saveSettings(settings);
  return { settings, message: 'Saved. Restart OpenCode to apply connection settings, then run /pocket-qr.' };
}
