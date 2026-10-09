import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  tokenHash: z.string(),
  created: z.number(),
  pushToken: z.string().optional(),
  ntfyTopic: z
    .string()
    .regex(/^occ-[a-f0-9]{48}$/)
    .optional(),
});
export type Device = z.infer<typeof DeviceSchema>;
const StateSchema = z.object({ devices: z.array(DeviceSchema) });
export const secret = () => randomBytes(32).toString('base64url');
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const equalSecret = (left: string, right: string) =>
  timingSafeEqual(Buffer.from(digest(left), 'hex'), Buffer.from(digest(right), 'hex'));

export async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class DeviceStore {
  devices: Device[] = [];
  private writes = Promise.resolve();

  constructor(readonly directory: string) {}

  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.devices = StateSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'devices.json'), 'utf8')),
      ).devices;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  authenticate(token: string): Device | undefined {
    const hash = digest(token);
    return this.devices.find((device) => equalSecret(device.tokenHash, hash));
  }

  async pair(name: string) {
    if (this.devices.length >= 100) throw new Error('Device limit reached; revoke an old device.');
    const token = secret();
    const device: Device = {
      id: randomBytes(12).toString('hex'),
      name,
      tokenHash: digest(token),
      created: Date.now(),
    };
    this.devices.push(device);
    try {
      await this.save();
    } catch (error) {
      this.devices = this.devices.filter((item) => item.id !== device.id);
      throw error;
    }
    return { token, deviceID: device.id };
  }

  async revoke(id: string) {
    const before = this.devices;
    this.devices = this.devices.filter((device) => device.id !== id);
    try {
      await this.save();
    } catch (error) {
      this.devices = before;
      throw error;
    }
  }

  async setPush(id: string, token?: string) {
    const device = this.devices.find((item) => item.id === id);
    if (!device) throw new Error('Unknown device');
    const previous = device.pushToken;
    device.pushToken = token;
    try {
      await this.save();
    } catch (error) {
      device.pushToken = previous;
      throw error;
    }
  }

  async setNtfy(id: string, enabled: boolean) {
    const device = this.devices.find((item) => item.id === id);
    if (!device) throw new Error('Unknown device');
    const previous = device.ntfyTopic;
    device.ntfyTopic = enabled ? (previous ?? `occ-${randomBytes(24).toString('hex')}`) : undefined;
    try {
      await this.save();
    } catch (error) {
      device.ntfyTopic = previous;
      throw error;
    }
    return device.ntfyTopic;
  }

  private save() {
    const snapshot = JSON.stringify({ devices: this.devices });
    const write = this.writes.then(() =>
      atomicJson(join(this.directory, 'devices.json'), JSON.parse(snapshot)),
    );
    this.writes = write.catch(() => undefined);
    return write;
  }
}

export class PairingCodes {
  private codes = new Map<string, number>();

  create(): { code: string; expires: number } {
    for (const [code, expiry] of this.codes) if (expiry < Date.now()) this.codes.delete(code);
    if (this.codes.size >= 10) this.codes.delete(this.codes.keys().next().value!);
    const code = randomBytes(12).toString('base64url');
    const expires = Date.now() + 10 * 60_000;
    this.codes.set(digest(code), expires);
    return { code, expires };
  }

  consume(code: string): boolean {
    const key = digest(code);
    const expires = this.codes.get(key);
    this.codes.delete(key);
    return expires !== undefined && expires > Date.now();
  }
}
