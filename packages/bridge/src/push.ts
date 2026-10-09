import { connect } from 'node:http2';
import { sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APP_ID, notificationFor, type ServerEvent } from '../../../shared/protocol';
import type { DeviceStore } from './state';
import { NotificationGate } from '../../../shared/notification-policy';

export type PushOptions = {
  apns?: { keyFile: string; keyId: string; teamId: string; topic?: string; production?: boolean };
  ntfy?: { url: string; token?: string };
};

export class PushService {
  private gate = new NotificationGate();
  private jwt?: { token: string; created: number };
  constructor(
    readonly options: PushOptions,
    private devices: DeviceStore,
    private log: (message: string) => void,
  ) {}

  async dispatch(event: ServerEvent) {
    const notification = notificationFor(event);
    if (!notification || !this.gate.accept(event)) return;
    return this.deliver(notification);
  }

  async test(deviceID: string) {
    return this.deliver(
      { title: 'Проверка уведомлений OCC', body: 'Канал доставки работает. Это тестовое уведомление.' },
      deviceID,
    );
  }

  private async deliver(
    notification: { title: string; body: string; sessionID?: string },
    deviceID?: string,
  ) {
    const jobs: Promise<unknown>[] = [];
    const targets = this.devices.devices.filter((device) => !deviceID || device.id === deviceID);
    const channels: NonNullable<PushOptions['ntfy']>[] = targets
      .filter((device) => device.ntfyTopic)
      .map((device) => ({ url: `https://ntfy.sh/${device.ntfyTopic}` }));
    if (this.options.ntfy && (!deviceID || !channels.length)) channels.push(this.options.ntfy);
    for (const { url, token } of channels) {
      const endpoint = new URL(url);
      jobs.push(
        fetch(`${endpoint.origin}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            topic: new URL(url).pathname.slice(1),
            title: notification.title,
            message: notification.body,
            priority: 4,
            tags: ['computer'],
            click: notification.sessionID
              ? `occ://session?id=${encodeURIComponent(notification.sessionID)}`
              : 'occ://inbox',
          }),
          signal: AbortSignal.timeout(10_000),
        }).then((response) => {
          if (!response.ok) throw new Error(`ntfy HTTP ${response.status}`);
        }),
      );
    }
    if (this.options.apns) {
      for (const device of targets) {
        if (!device.pushToken || device.ntfyTopic) continue;
        jobs.push(
          this.apns(device.pushToken, {
            aps: {
              alert: { title: notification.title, body: notification.body },
              sound: 'default',
              'thread-id': notification.sessionID ?? 'occ',
            },
            sessionID: notification.sessionID,
          }).catch(async (error: unknown) => {
            if (error instanceof Error && /BadDeviceToken|Unregistered/.test(error.message))
              await this.devices.setPush(device.id);
            throw error;
          }),
        );
      }
    }
    let delivered = 0;
    for (const result of await Promise.allSettled(jobs)) {
      if (result.status === 'fulfilled') delivered++;
      if (result.status === 'rejected')
        this.log(
          `Push delivery failed: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}`,
        );
    }
    return { attempted: jobs.length, delivered, failed: jobs.length - delivered };
  }

  private async authorization(): Promise<string> {
    if (this.jwt && Date.now() - this.jwt.created < 45 * 60_000) return this.jwt.token;
    const config = this.options.apns!;
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: config.keyId })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) }),
    ).toString('base64url');
    const data = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(data), {
      key: await readFile(config.keyFile),
      dsaEncoding: 'ieee-p1363',
    });
    this.jwt = { token: `${data}.${signature.toString('base64url')}`, created: Date.now() };
    return this.jwt.token;
  }

  private async apns(deviceToken: string, payload: unknown) {
    const authorization = await this.authorization();
    const config = this.options.apns!;
    return new Promise<void>((resolve, reject) => {
      const client = connect(
        config.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com',
      );
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error('APNs timeout'));
      }, 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        client.close();
        if (error) reject(error);
        else resolve();
      };
      client.once('error', finish);
      const request = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${authorization}`,
        'apns-topic': config.topic ?? APP_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      });
      let status = 0;
      let body = '';
      request.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        if (body.length < 4096) body += chunk;
      });
      request.once('error', finish);
      request.on('end', () => finish(status === 200 ? undefined : new Error(`APNs ${status}: ${body}`)));
      request.end(JSON.stringify(payload));
    });
  }
}

export function pushFromEnvironment(): PushOptions {
  const env = process.env;
  return {
    apns:
      env.OCC_APNS_KEY_FILE && env.OCC_APNS_KEY_ID && env.OCC_APNS_TEAM_ID
        ? {
            keyFile: env.OCC_APNS_KEY_FILE,
            keyId: env.OCC_APNS_KEY_ID,
            teamId: env.OCC_APNS_TEAM_ID,
            topic: env.OCC_APNS_TOPIC,
            production: env.OCC_APNS_PRODUCTION === '1',
          }
        : undefined,
    ntfy: env.OCC_NTFY_URL ? { url: env.OCC_NTFY_URL, token: env.OCC_NTFY_TOKEN } : undefined,
  };
}
