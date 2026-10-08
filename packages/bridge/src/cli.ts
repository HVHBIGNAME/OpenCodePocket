#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { createBridge } from './server';
import {
  cloudflareTunnel,
  displayPairing,
  installPlugin,
  lanAddress,
  readSettings,
  SettingsSchema,
  stateHome,
  upstreamAuthorization,
} from './setup';
import { pushFromEnvironment } from './push';
import { reportOptions } from './reports';
import { managePocket, requestPairing } from './management';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      upstream: { type: 'string' },
      port: { type: 'string' },
      url: { type: 'string' },
      name: { type: 'string' },
      tunnel: { type: 'boolean' },
      lan: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      origin: { type: 'string', multiple: true },
      'local-reports': { type: 'boolean' },
      'no-open': { type: 'boolean' },
    },
  });
  const command = positionals[0] ?? 'help';
  if (values.help || command === 'help') {
    console.log(`OpenCode Pocket / OCC

  occ-pocket install               Install plugin + commands; download cloudflared automatically
  occ-pocket install --lan          Install for Wi-Fi / VPN; listens on all interfaces
  occ-pocket install --url URL      Install behind an existing HTTPS tunnel
  occ-pocket start --tunnel         Run the companion without a plugin
  occ-pocket pair                  Generate another single-use pairing QR
  occ-pocket status                Check connection and paired devices
  occ-pocket config --lan          Save Wi-Fi/VPN mode (restart OpenCode to apply)
  occ-pocket config --tunnel       Save automatic tunnel mode
  occ-pocket config --name NAME    Change the computer name

Reports: redacted client diagnostics are queued locally and mirrored to
HVHBIGNAME/OpenCodePocket Issues using gh auth on this computer.
Use --local-reports to keep reports on this computer only.

Options: --upstream http://127.0.0.1:4096  --port 4141  --name NAME
         --origin http://127.0.0.1:1420 (development browser, repeatable)

Restart OpenCode after installing, then use /pocket, /pocket-qr, /pocket-config.
The installer enables the local HTTP port when no port is configured.
Keep existing sessions: use the port of the running OpenCode server as --upstream.
Config: ${join(stateHome(), 'bridge.json')}`);
    return;
  }
  const saved = await readSettings();
  if ([values.url, values.tunnel, values.lan].filter(Boolean).length > 1)
    throw new Error('Choose only one connection mode: --tunnel, --lan or --url');
  const settings = SettingsSchema.parse({
    ...saved,
    ...(values.port ? { port: Number(values.port) } : {}),
    ...(values.name ? { name: values.name } : {}),
    ...(values.upstream ? { upstream: values.upstream } : {}),
    ...(values.url ? { publicUrl: values.url, tunnel: false } : {}),
    ...(values.tunnel ? { tunnel: true, hostname: '127.0.0.1', publicUrl: undefined } : {}),
    ...(values.lan ? { tunnel: false, hostname: '0.0.0.0', publicUrl: undefined } : {}),
    ...(values.origin ? { origins: values.origin } : {}),
    ...(values['local-reports'] ? { reportsGithub: false } : {}),
  });
  if (command === 'install') {
    const destination = await installPlugin(settings);
    console.log(
      `\nInstalled: ${destination}\n\nRestart OpenCode, then run /pocket-qr.\n/pocket opens the menu; /pocket-config changes connection settings.\n`,
    );
    return;
  }
  if (command === 'pair') {
    console.log(await requestPairing(!values['no-open'], true, values.url));
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify(await managePocket({ action: 'status' }), null, 2));
    return;
  }
  if (command === 'config') {
    console.log(
      JSON.stringify(
        await managePocket({
          action: Object.keys(values).length ? 'configure' : 'settings',
          mode: values.lan ? 'lan' : values.tunnel ? 'tunnel' : values.url ? 'custom' : undefined,
          url: values.url,
          name: values.name,
          port: values.port ? Number(values.port) : undefined,
          reportsGithub: values['local-reports'] ? false : undefined,
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command !== 'start') throw new Error(`Unknown command: ${command}. See --help.`);
  const bridge = await createBridge({
    ...settings,
    stateDirectory: stateHome(),
    upstreamAuthorization: upstreamAuthorization(),
    push: pushFromEnvironment(),
    reports: reportOptions(settings),
    pairingReady: false,
  });
  let tunnel: Awaited<ReturnType<typeof cloudflareTunnel>> | undefined;
  try {
    if (settings.tunnel) tunnel = await cloudflareTunnel(bridge.localUrl, console.error);
    const url =
      tunnel?.url ??
      settings.publicUrl ??
      (values.lan || settings.hostname === '0.0.0.0' ? lanAddress(settings.port) : bridge.localUrl);
    bridge.setPublicUrl(url);
    await displayPairing(bridge.createPairing(), true);
    console.log(`OCC bridge: ${bridge.localUrl}\nOpenCode: ${settings.upstream}\nPress Ctrl+C to stop.`);
  } catch (error) {
    await bridge.close();
    throw error;
  }
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    tunnel?.process.kill();
    void bridge.close().catch(console.error);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

main().catch((error: unknown) => {
  console.error(`OCC: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
