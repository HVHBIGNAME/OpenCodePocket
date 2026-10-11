import { tool, type Plugin } from '@opencode-ai/plugin';
import { createBridge } from './server';
import {
  cloudflareTunnel,
  displayPairing,
  lanAddress,
  readSettings,
  stateHome,
  upstreamAuthorization,
} from './setup';
import { pushFromEnvironment } from './push';
import { reportOptions } from './reports';
import { managePocket } from './management';
import { installedCommands } from './commands';
import { setTimeout as delay } from 'node:timers/promises';

async function startBridge(options: Parameters<typeof createBridge>[0]) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await createBridge(options);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt >= 20) throw error;
      await delay(250);
    }
  }
}

type Running = {
  references: number;
  ready: Promise<void>;
  close: () => Promise<void>;
  shutdown?: ReturnType<typeof setTimeout>;
};
const key = Symbol.for('dev.hvhbigname.occ.bridge');
const registry = globalThis as typeof globalThis & { [key: symbol]: Promise<Running> | undefined };

const PocketPlugin: Plugin = async (context) => {
  const log = (message: string) => {
    void context.client.app
      .log({ body: { service: 'occ-pocket', level: 'info', message } })
      .catch(() => console.error(`OCC: ${message}`));
  };
  if (!registry[key]) {
    registry[key] = (async () => {
      const settings = await readSettings();
      const bridge = await startBridge({
        ...settings,
        upstream: context.serverUrl.toString(),
        stateDirectory: stateHome(),
        upstreamAuthorization: upstreamAuthorization(),
        push: pushFromEnvironment(),
        reports: reportOptions(settings),
        pairingReady: false,
        log,
      });
      let tunnel: Awaited<ReturnType<typeof cloudflareTunnel>> | undefined;
      const abort = new AbortController();
      const ready = (async () => {
        if (settings.tunnel) tunnel = await cloudflareTunnel(bridge.localUrl, log, abort.signal);
        if (abort.signal.aborted) return;
        bridge.setPublicUrl(
          tunnel?.url ??
            settings.publicUrl ??
            (settings.hostname === '0.0.0.0' ? lanAddress(settings.port) : bridge.localUrl),
        );
        const page = await displayPairing(bridge.createPairing(), false);
        log(`OpenCode Pocket ready. QR: ${page}. Connect: /pocket-qr. Settings: /pocket-config.`);
      })().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        bridge.setPairingError(message);
        log(message);
      });
      return {
        references: 0,
        ready,
        close: async () => {
          abort.abort();
          tunnel?.process.kill();
          await bridge.close();
        },
      };
    })().catch((error: unknown) => {
      registry[key] = undefined;
      throw error;
    });
  }
  const instance = await registry[key]!;
  clearTimeout(instance.shutdown);
  instance.references++;
  return {
    config: async (config) => {
      config.command ??= {};
      for (const [name, definition] of Object.entries(await installedCommands(stateHome()))) {
        config.command[name] ??= definition;
      }
    },
    tool: {
      pocket_manage: tool({
        description:
          'Manage OpenCode Pocket: open a pairing QR locally, inspect connection status, or save connection settings. Never read pairing.html or runtime.json into chat.',
        args: {
          action: tool.schema.enum(['qr', 'status', 'settings', 'configure']),
          mode: tool.schema.enum(['tunnel', 'lan', 'custom']).optional(),
          url: tool.schema.string().optional(),
          name: tool.schema.string().optional(),
          port: tool.schema.number().optional(),
          reportsGithub: tool.schema.boolean().optional(),
        },
        execute: async (input) => {
          if (input.action === 'qr') await instance.ready;
          return JSON.stringify(await managePocket(input), null, 2);
        },
      }),
    },
    dispose: async () => {
      instance.references--;
      if (instance.references === 0) {
        // Config PATCH disposes and recreates OpenCode instances. Keep the same tunnel during that handoff.
        instance.shutdown = setTimeout(() => {
          if (instance.references !== 0) return;
          registry[key] = undefined;
          void instance.close().catch((error: unknown) => log(String(error)));
        }, 60_000);
        instance.shutdown.unref();
      }
    },
  };
};

export default PocketPlugin;
