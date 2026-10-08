import { beforeEach, describe, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request } }));
vi.mock('../../src/lib/native', () => ({ isNative: true, platform: 'ios', PocketNative: {} }));
vi.mock('../../src/lib/diagnostics', () => ({ captureDiagnostic: vi.fn() }));
import { http } from '../../src/lib/api';
import { isAbortedTool, isGenerationCancelled } from '../../src/lib/session-errors';

beforeEach(() => request.mockReset());
describe('native requests and cancellation', () => {
  it('gives iOS enough time for uploads instead of overriding readTimeout with 15 seconds', async () => {
    request.mockResolvedValue({ status: 204, data: '' });
    const data = {
      parts: [{ type: 'file', filename: 'Фото.jpg', mime: 'image/jpeg', url: 'data:image/jpeg;base64,AA==' }],
    };
    await http('http://127.0.0.1:4141/api/session/s/prompt_async', 'POST', data, 'Bearer test');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', data, connectTimeout: 120_000, readTimeout: 120_000 }),
    );
  });
  it('distinguishes a cancelled generation from a network or provider failure', () => {
    expect(isGenerationCancelled({ name: 'MessageAbortedError', data: { message: 'aborted' } })).toBe(true);
    expect(isGenerationCancelled({ name: 'APIError', data: { message: 'connection timed out' } })).toBe(
      false,
    );
    expect(isAbortedTool('The operation was aborted.')).toBe(true);
    expect(isAbortedTool('Network timeout')).toBe(false);
  });
});
