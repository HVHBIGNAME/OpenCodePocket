import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request } }));
vi.mock('../../src/lib/native', () => ({ isNative: true, platform: 'ios', PocketNative: {} }));
vi.mock('../../src/lib/diagnostics', () => ({ captureDiagnostic: vi.fn() }));
import { http, OpenCodeClient } from '../../src/lib/api';
import { isAbortedTool, isGenerationCancelled } from '../../src/lib/session-errors';

beforeEach(() => request.mockReset());
afterEach(() => vi.useRealTimers());
describe('native requests and cancellation', () => {
  const client = new OpenCodeClient({
    id: 'fixture',
    name: 'fixture',
    url: 'http://localhost:4141',
    mode: 'bridge',
    credential: 'fixture',
  });
  it('recovers a transient read without exceeding the original timeout', async () => {
    vi.useFakeTimers();
    request
      .mockResolvedValueOnce({ status: 502, data: '{}' })
      .mockResolvedValueOnce({ status: 200, data: '[]' });
    const result = client.request('/provider', { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(400);
    await expect(result).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].connectTimeout).toBe(600);
  });
  it('never automatically retries a failed prompt or permission mutation', async () => {
    request.mockResolvedValue({ status: 502, data: '{}' });
    await expect(
      client.request('/session/s/prompt_async', { method: 'POST', data: { parts: [] } }),
    ).rejects.toMatchObject({ status: 502 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('cancels the waiting retry when its screen is closed', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    request.mockResolvedValue({ status: 503, data: '{}' });
    const result = client.request('/file', { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects successful tunnel HTML responses instead of passing a string to the UI', async () => {
    request.mockResolvedValue({ status: 200, data: '<html>login</html>' });
    await expect(http('https://example.test/api')).rejects.toMatchObject({ status: 502 });
  });
  it('does not dispatch an already cancelled native request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      http('https://example.test/api', 'GET', undefined, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
  it('does not apply native responses cancelled while in flight', async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => {
      controller.abort();
      return { status: 200, data: '[]' };
    });
    await expect(
      http('https://example.test/api', 'GET', undefined, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
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
