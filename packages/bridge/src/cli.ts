#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBridge } from './server';
import { cloudflareTunnel, displayPairing, installPlugin, lanAddress, readSettings, SettingsSchema, stateHome, upstreamAuthorization } from './setup';
import { pushFromEnvironment } from './push';
import { z } from 'zod';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    upstream: { type: 'string' }, port: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' },
    tunnel: { type: 'boolean' }, lan: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    origin: { type: 'string', multiple: true },
  } });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(`OpenCode Pocket / OCC 1.0.0

  occ-pocket install --tunnel       Install the auto-start OpenCode plugin (cloudflared required)
  occ-pocket install --lan          Install for Wi-Fi / VPN; listens on all interfaces
  occ-pocket install --url URL      Install behind an existing HTTPS tunnel
  occ-pocket start --tunnel         Run the companion without a plugin
  occ-pocket pair                  Generate another single-use pairing QR

Options: --upstream http://127.0.0.1:4096  --port 4141  --name NAME
         --origin http://127.0.0.1:1420 (development browser, repeatable)

Restart OpenCode after installing. Start it with: opencode --port 4096
Keep existing sessions: use the port of the running OpenCode server as --upstream.
Config: ${join(stateHome(), 'bridge.json')}`);
    return;
  }
  const saved = await readSettings();
  const settings = SettingsSchema.parse({ ...saved,
    ...(values.port ? { port: Number(values.port) } : {}),
    ...(values.name ? { name: values.name } : {}),
    ...(values.upstream ? { upstream: values.upstream } : {}),
    ...(values.url ? { publicUrl: values.url, tunnel: false } : {}),
    ...(values.tunnel ? { tunnel: true, hostname: '127.0.0.1' } : {}),
    ...(values.lan ? { tunnel: false, hostname: '0.0.0.0' } : {}),
    ...(values.origin ? { origins: values.origin } : {}),
  });
  if (command === 'install') {
    const destination = await installPlugin(settings);
    console.log(`\nInstalled: ${destination}\n\nRestart OpenCode: opencode --port 4096\nThen run: occ-pocket pair\nThe plugin also writes a local pairing.html page.\n`);
    return;
  }
  if (command === 'pair') {
    const runtime = z.object({ url: z.string(), controlToken: z.string() }).parse(JSON.parse(await readFile(join(stateHome(), 'runtime.json'), 'utf8')));
    const response = await fetch(`${runtime.url}/occ/local/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OCC-Control': runtime.controlToken },
      body: JSON.stringify({ url: values.url }), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Pairing failed (${response.status}). Is the OCC plugin running?`);
    const pair = z.object({ link: z.string(), url: z.string(), name: z.string(), expires: z.number() }).parse(await response.json());
    await displayPairing(pair, true);
    return;
  }
  if (command !== 'start') throw new Error(`Unknown command: ${command}. See --help.`);
  const bridge = await createBridge({ ...settings, stateDirectory: stateHome(), upstreamAuthorization: upstreamAuthorization(), push: pushFromEnvironment() });
  let tunnel: Awaited<ReturnType<typeof cloudflareTunnel>> | undefined;
  try {
    if (settings.tunnel) tunnel = await cloudflareTunnel(bridge.localUrl, console.error);
    const url = tunnel?.url ?? settings.publicUrl ?? (values.lan || settings.hostname === '0.0.0.0' ? lanAddress(settings.port) : bridge.localUrl);
    bridge.setPublicUrl(url);
    await displayPairing(bridge.createPairing(), true);
    console.log(`OCC bridge: ${bridge.localUrl}\nOpenCode: ${settings.upstream}\nPress Ctrl+C to stop.`);
  } catch (error) { await bridge.close(); throw error; }
  let closing = false;
  const close = () => { if (closing) return; closing = true; tunnel?.process.kill(); void bridge.close().catch(console.error); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

main().catch((error: unknown) => { console.error(`OCC: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
