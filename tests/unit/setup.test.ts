import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { cloudflaredAsset, downloadVerified } from '../../packages/bridge/src/cloudflared';
import { configureOpenCode } from '../../packages/bridge/src/install-config';
import { waitForTunnel, readSettings, saveSettings, SettingsSchema } from '../../packages/bridge/src/setup';
import { managePocket } from '../../packages/bridge/src/management';

const directories: string[] = [];
async function temporary() {
  const root = join(process.cwd(), '.cache', 'setup-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'test-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe('Pocket setup', () => {
  it('selects official pinned binaries and rejects unsupported platforms', () => {
    for (const [platform, arch] of [
      ['win32', 'x64'],
      ['win32', 'arm64'],
      ['linux', 'arm64'],
      ['darwin', 'x64'],
    ]) {
      const asset = cloudflaredAsset(platform!, arch!);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(asset.url).toContain('https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/');
    }
    expect(() => cloudflaredAsset('unknown', 'unknown')).toThrow('unavailable');
  });

  it('refuses a corrupted download and saves only a matching payload', async () => {
    const directory = await temporary();
    const file = join(directory, 'binary');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('verified payload')),
    );
    await expect(downloadVerified('https://example.com/binary', '0'.repeat(64), file)).rejects.toThrow(
      'checksum mismatch',
    );
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const hash = createHash('sha256').update('verified payload').digest('hex');
    await downloadVerified('https://example.com/binary', hash, file);
    expect(await readFile(file, 'utf8')).toBe('verified payload');
  });

  it('does not treat a Cloudflare URL returning HTTP 530 as ready', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return new Response('unavailable', { status: 530 });
      }),
    );
    await expect(waitForTunnel('https://example.trycloudflare.com', controller.signal)).rejects.toThrow(
      'HTTP 530',
    );
  });

  it('accepts a tunnel only when the bridge health endpoint answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ name: 'OpenCodePocket' })),
    );
    await expect(
      waitForTunnel('https://example.trycloudflare.com', new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('preserves JSONC comments, existing plugins and a custom server port on repeated installs', async () => {
    const directory = await temporary();
    await writeFile(
      join(directory, 'opencode.jsonc'),
      '{\n// my config\n"server":{"port":7777},"model":"provider/model"\n}',
    );
    await writeFile(
      join(directory, 'tui.jsonc'),
      '{\n// my theme\n"theme":"catppuccin","plugin":["existing-plugin"],\n}',
    );
    await configureOpenCode(directory, join(directory, 'tui.mjs'));
    const first = await readFile(join(directory, 'tui.jsonc'), 'utf8');
    await configureOpenCode(directory, join(directory, 'tui.mjs'));
    expect(await readFile(join(directory, 'tui.jsonc'), 'utf8')).toBe(first);
    expect(first).toContain('// my theme');
    expect(parse(first).plugin).toHaveLength(2);
    expect(parse(first).plugin[0]).toBe('existing-plugin');
    const config = await readFile(join(directory, 'opencode.jsonc'), 'utf8');
    expect(config).toContain('// my config');
    expect(parse(config)).toMatchObject({ server: { port: 7777 }, model: 'provider/model' });
  });

  it('enables the local HTTP port for a fresh configuration', async () => {
    const directory = await temporary();
    await configureOpenCode(directory, join(directory, 'tui.mjs'));
    expect(JSON.parse(await readFile(join(directory, 'opencode.json'), 'utf8'))).toMatchObject({
      server: { port: 4096 },
    });
  });

  it('does not overwrite malformed configuration', async () => {
    const directory = await temporary();
    const file = join(directory, 'opencode.jsonc');
    await writeFile(file, '{broken');
    await expect(configureOpenCode(directory, join(directory, 'tui.mjs'))).rejects.toThrow('Invalid');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });

  it('persists connection modes without retaining a stale custom tunnel URL', async () => {
    const directory = await temporary();
    vi.stubEnv('OCC_STATE_DIR', directory);
    await saveSettings(SettingsSchema.parse({ tunnel: false, publicUrl: 'https://old.example.com' }));
    await managePocket({ action: 'configure', mode: 'lan', name: 'Workstation' }, false);
    expect(await readSettings()).toMatchObject({ tunnel: false, hostname: '0.0.0.0', name: 'Workstation' });
    expect((await readSettings()).publicUrl).toBeUndefined();
    await managePocket({ action: 'configure', mode: 'tunnel' }, false);
    expect(await readSettings()).toMatchObject({ tunnel: true, hostname: '127.0.0.1' });
    await expect(managePocket({ action: 'configure', mode: 'custom' }, false)).rejects.toThrow('Specify');
    await expect(managePocket({ action: 'configure', port: 0 }, false)).rejects.toThrow();
  });
});
