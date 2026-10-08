import { hostname, homedir, networkInterfaces } from 'node:os';
import { join, dirname } from 'node:path';
import { readFile, mkdir, writeFile, copyFile, access } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import { atomicJson } from './state';
import { ensureCloudflared } from './cloudflared';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeServerUrl } from '../../../shared/protocol';
import { configureOpenCode } from './install-config';

export const configHome = () =>
  process.env.OPENCODE_CONFIG_DIR ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'opencode');
export const stateHome = () => process.env.OCC_STATE_DIR ?? join(configHome(), 'occ-pocket');
export const SettingsSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(4141),
  hostname: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
  name: z.string().max(100).default(hostname()),
  tunnel: z.boolean().default(true),
  publicUrl: z.string().transform(normalizeServerUrl).optional(),
  upstream: z.string().default('http://127.0.0.1:4096'),
  origins: z.array(z.string()).default([]),
  reportsGithub: z.boolean().default(true),
  reportsRepository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .default('HVHBIGNAME/OpenCodePocket'),
});
export type Settings = z.infer<typeof SettingsSchema>;

export async function saveSettings(settings: Settings) {
  await mkdir(stateHome(), { recursive: true, mode: 0o700 });
  await atomicJson(join(stateHome(), 'bridge.json'), SettingsSchema.parse(settings));
}

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
      if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))
        return `http://${address.address}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
}

export async function waitForTunnel(url: string, signal: AbortSignal) {
  let failure = 'not reachable';
  while (!signal.aborted) {
    try {
      const response = await fetch(`${url}/healthz`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      if (response.ok && (await response.json()).name === 'OpenCodePocket') return;
      failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    try {
      await delay(1000, undefined, { signal });
    } catch {
      break;
    }
  }
  throw new Error(
    `Cloudflare tunnel is not ready (${failure}). Use LAN in /pocket-config or check the network.`,
  );
}

export async function cloudflareTunnel(
  localUrl: string,
  onExit: (message: string) => void,
  signal?: AbortSignal,
): Promise<{ url: string; process: ChildProcess }> {
  const binary = await ensureCloudflared(stateHome(), onExit);
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', localUrl], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let resolved = false;
    let checking = false;
    let output = '';
    const abort = new AbortController();
    const cancel = () => {
      clearTimeout(timer);
      abort.abort();
      child.kill();
      reject(new Error('Tunnel startup cancelled'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      abort.abort();
      child.kill();
      if (!checking)
        reject(new Error('Cloudflare did not provide a tunnel URL. Use /pocket-config to select LAN.'));
    }, 90_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      abort.abort();
      reject(new Error(`Could not start cloudflared: ${error.message}`));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-10_000);
      const url = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
      if (url && !checking) {
        checking = true;
        void waitForTunnel(url, abort.signal)
          .then(() => {
            resolved = true;
            clearTimeout(timer);
            resolve({ url, process: child });
          })
          .catch((error: unknown) => {
            clearTimeout(timer);
            child.kill();
            reject(error);
          });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      abort.abort();
      if (resolved) onExit(`Cloudflare tunnel stopped (${code ?? 'signal'}). Restart OCC to reconnect.`);
      else if (!checking)
        reject(new Error(`Cloudflared exited (${code}). Check network access or use your own tunnel.`));
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
<h1>Подключение</h1><p>OCC → Сканировать QR</p><img src="${image}" alt="Одноразовый QR-код подключения"><p>${escapeHtml(pair.name)} · ${escapeHtml(pair.url)}</p><p><a href="${escapeHtml(pair.link)}">Открыть в OCC</a></p><p><code>${escapeHtml(pair.link)}</code></p><small>Одно использование. Действует до ${escapeHtml(new Date(pair.expires).toLocaleTimeString())}. Новый QR в OpenCode: /pocket-qr</small></html>`,
    { mode: 0o600 },
  );
  if (terminal) {
    console.log(await QRCode.toString(pair.link, { type: 'terminal', small: true }));
    console.log(`\n${pair.name}\n${pair.link}\n\nQR page: ${path}\nExpires in 10 minutes. One use.\n`);
  }
  return path;
}

export async function installPlugin(settings: Settings) {
  if (settings.tunnel) await ensureCloudflared(stateHome(), console.log);
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
  await copyFile(join(dirname(bundle), 'tui.js'), join(stateHome(), 'tui.mjs'));
  const cli = fileURLToPath(import.meta.url);
  if (cli !== join(stateHome(), 'cli.mjs')) await copyFile(cli, join(stateHome(), 'cli.mjs'));
  await configureOpenCode(configHome(), join(stateHome(), 'tui.mjs'));
  await saveSettings(settings);
  return destination;
}
