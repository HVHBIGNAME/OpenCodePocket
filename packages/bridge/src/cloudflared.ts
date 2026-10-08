import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const version = '2026.10.0';
const assets: Record<string, [string, string]> = {
  'win32-x64': [
    'cloudflared-windows-amd64.exe',
    '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  ],
  'win32-arm64': [
    'cloudflared-windows-amd64.exe',
    '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  ],
  'win32-ia32': [
    'cloudflared-windows-386.exe',
    '0630a8779e9823a1a3b091698b8e71874e0f7b205559219f52fdd301466b5546',
  ],
  'linux-x64': [
    'cloudflared-linux-amd64',
    'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
  ],
  'linux-arm64': [
    'cloudflared-linux-arm64',
    'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08',
  ],
  'linux-arm': ['cloudflared-linux-arm', '1dbe8e4ec17e74bb7f49cf91db6a4903bd0f9fe41984556c7503e40b765fd099'],
  'linux-ia32': ['cloudflared-linux-386', 'f6fbd789e6ce9c824d4d560cbbfad2753d55ce398ece16b4c9fbf17271dceab3'],
  'darwin-x64': [
    'cloudflared-darwin-amd64.tgz',
    '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f',
  ],
  'darwin-arm64': [
    'cloudflared-darwin-arm64.tgz',
    'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70',
  ],
};

export function cloudflaredAsset(platform: string, arch: string) {
  const asset = assets[`${platform}-${arch}`];
  if (!asset)
    throw new Error(
      `Automatic cloudflared download is unavailable for ${platform}/${arch}. Use LAN or an existing tunnel.`,
    );
  return {
    name: asset[0],
    sha256: asset[1],
    url: `https://github.com/cloudflare/cloudflared/releases/download/${version}/${asset[0]}`,
  };
}

export async function downloadVerified(url: string, sha256: string, destination: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 90 * 1024 * 1024) throw new Error('Download exceeds the size limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    throw new Error('Download checksum mismatch; the executable was not installed');
  await writeFile(destination, bytes, { mode: 0o600 });
}

async function available(binary: string) {
  try {
    const result = await execute(binary, ['--version'], { timeout: 10_000, windowsHide: true });
    return /cloudflared version /i.test(result.stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error(`Cannot run ${binary}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const pending = new Map<string, Promise<string>>();
export async function ensureCloudflared(home: string, log: (message: string) => void): Promise<string> {
  const override = process.env.OCC_CLOUDFLARED_PATH;
  if (override) {
    if (await available(override)) return override;
    throw new Error('OCC_CLOUDFLARED_PATH does not point to cloudflared');
  }
  if (await available('cloudflared')) return 'cloudflared';
  const existing = pending.get(home);
  if (existing) return existing;
  const task = installCloudflared(home, log);
  pending.set(home, task);
  try {
    return await task;
  } finally {
    pending.delete(home);
  }
}

async function installCloudflared(home: string, log: (message: string) => void) {
  const asset = cloudflaredAsset(process.platform, process.arch);
  const directory = join(home, 'bin', `cloudflared-${version}`);
  const binary = join(directory, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await available(binary)) return binary;
  const staging = await mkdtemp(join(directory, 'download-'));
  try {
    log(`Downloading cloudflared ${version} for ${process.platform}/${process.arch}…`);
    const archive = join(staging, asset.name);
    await downloadVerified(asset.url, asset.sha256, archive);
    let executable = archive;
    if (asset.name.endsWith('.tgz')) {
      await execute('tar', ['-xzf', archive, '-C', staging, 'cloudflared'], { timeout: 30_000 });
      executable = join(staging, 'cloudflared');
    }
    await chmod(executable, 0o755);
    if (!(await available(executable))) throw new Error('Downloaded cloudflared failed its version check');
    await rename(executable, binary);
    log('cloudflared installed. No administrator permissions or PATH changes needed.');
    return binary;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
