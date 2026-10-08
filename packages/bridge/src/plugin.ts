import type { Plugin } from '@opencode-ai/plugin';
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

type Running = { references: number; close: () => Promise<void>; shutdown?: ReturnType<typeof setTimeout> };
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
      const bridge = await createBridge({
        ...settings,
        upstream: context.serverUrl.toString(),
        stateDirectory: stateHome(),
        upstreamAuthorization: upstreamAuthorization(),
        push: pushFromEnvironment(),
        reports: reportOptions(settings),
        log,
      });
      let tunnel: Awaited<ReturnType<typeof cloudflareTunnel>> | undefined;
      try {
        if (settings.tunnel) tunnel = await cloudflareTunnel(bridge.localUrl, log);
        bridge.setPublicUrl(
          tunnel?.url ??
            settings.publicUrl ??
            (settings.hostname === '0.0.0.0' ? lanAddress(settings.port) : bridge.localUrl),
        );
        const page = await displayPairing(bridge.createPairing(), false);
        log(
          `OpenCode Pocket ready. QR: ${page}. New QR: occ-pocket pair. OpenCode must listen on ${context.serverUrl}.`,
        );
      } catch (error) {
        await bridge.close();
        throw error;
      }
      return {
        references: 0,
        close: async () => {
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
