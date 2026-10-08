import { hostname, homedir, networkInterfaces } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import { atomicJson } from './state';

export const configHome = () =>
  process.env.OPENCODE_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode');
export const stateHome = () => process.env.OCC_STATE_DIR ?? join(configHome(), 'occ-pocket');
export const SettingsSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4141),
  hostname: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  name: z.string().max(100).default(hostname()),
  tunnel: z.boolean().default(false),
  publicUrl: z.string().optional(),
  upstream: z.string().default('http://127.0.0.1:4096'),
  origins: z.array(z.string()).default([]),
  reportsGithub: z.boolean().default(true),
  reportsRepository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('HVHBIGNAME/OpenCodePocket'),
});
export type Settings = z.infer<typeof SettingsSchema>;

export async function readSettings(): Promise<Settings> {
  try {
    return SettingsSchema.parse(JSON.parse(await readFile(join(stateHome(), 'bridge.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return SettingsSchema.parse({});
    throw error;
  }
}

export function upstreamAuthorization() {
  if (!process.env.OPENCODE_SERVER_PASSWORD) return undefined;
  return `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? 'opencode'}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
}

export function lanAddress(port: number) {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return `http://${address.address}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
}

export function cloudflareTunnel(
  localUrl: string,
  onExit: (message: string) => void,
): Promise<{ url: string; process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', localUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let resolved = false;
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Cloudflare tunnel did not start in 45 seconds'));
    }, 45_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Install cloudflared or use --url/--lan. ${error.message}`));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-10_000);
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ url, process: child });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (resolved) onExit(`Cloudflare tunnel stopped (${code ?? 'signal'}). Restart OCC to reconnect.`);
      else reject(new Error(`Cloudflared exited (${code}). Check network access or use your own tunnel.`));
    });
  });
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export async function displayPairing(
  pair: { link: string; url: string; name: string; expires: number },
  terminal: boolean,
) {
  const image = await QRCode.toDataURL(pair.link, { margin: 2, width: 420, errorCorrectionLevel: 'M' });
  const path = join(stateHome(), 'pairing.html');
  await mkdir(stateHome(), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to OCC</title>
<style>body{background:#101310;color:#f0f2e8;font:17px system-ui;max-width:520px;margin:60px auto;padding:24px}small{color:#a1ad9b}h1{font-size:48px;letter-spacing:-2px}em{color:#d2ff5a;font-style:normal}img{width:100%;max-width:340px;border-radius:20px}a{color:#d2ff5a;overflow-wrap:anywhere}code{font-size:13px;overflow-wrap:anywhere}</style>
<small>HVHBIGNAME / OPEN CODE POCKET</small><h1>Твой код.<br><em>Всегда рядом.</em></h1><p>OCC → Подключить → Сканировать QR</p><img src="${image}" alt="Одноразовый QR-код подключения"><p>${escapeHtml(pair.name)} · ${escapeHtml(pair.url)}</p><p><a href="${escapeHtml(pair.link)}">Открыть в OCC</a></p><p><code>${escapeHtml(pair.link)}</code></p><small>Одно использование. Действует до ${escapeHtml(new Date(pair.expires).toLocaleTimeString())}. Создать новый: occ-pocket pair</small></html>`,
    { mode: 0o600 },
  );
  if (terminal) {
    console.log(await QRCode.toString(pair.link, { type: 'terminal', small: true }));
    console.log(`\n${pair.name}\n${pair.link}\n\nQR page: ${path}\nExpires in 10 minutes. One use.\n`);
  }
  return path;
}

export async function installPlugin(settings: Settings) {
  const directory = join(configHome(), 'plugins');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(stateHome(), { recursive: true, mode: 0o700 });
  const bundle = join(dirname(fileURLToPath(import.meta.url)), 'plugin.js');
  await access(bundle);
  const destination = join(directory, 'occ-pocket.js');
  try {
    await copyFile(destination, join(stateHome(), 'occ-pocket.previous.js'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await copyFile(bundle, destination);
  await atomicJson(join(stateHome(), 'bridge.json'), settings);
  return destination;
}
