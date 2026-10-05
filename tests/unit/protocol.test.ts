import { describe, expect, it } from 'vitest';
import { decodeEvent, isPrivateHost, normalizeServerUrl, notificationFor, pairingLink, parsePairing, SseDecoder } from '../../shared/protocol';

describe('connection boundaries', () => {
  it('round-trips single-use links without embedding OpenCode credentials', () => {
    const pairing = { url: 'https://tunnel.example/occ', code: 'a-very-long-pair-code', name: 'Домашний ПК' };
    expect(parsePairing(pairingLink(pairing))).toEqual(pairing);
    expect(pairingLink(pairing)).not.toMatch(/password|token/);
  });
  it.each(['http://example.com', 'ftp://localhost', 'https://user:pass@server.com', 'https://server.com?token=secret', 'https://server.com/#secret'])('rejects unsafe server address %s', (input) => {
    expect(() => normalizeServerUrl(input)).toThrow();
  });
  it.each(['127.0.0.1', '10.0.0.2', '192.168.1.20', '172.16.3.1', '100.100.2.1', '[::1]', 'desktop.local'])('permits private server %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
    expect(normalizeServerUrl(`http://${host}:4141/`)).toBe(`http://${host}:4141`);
  });
  it.each(['10.0.0.2.evil.com', '172.32.0.1', '100.10.0.1', '192.169.0.1', '10.999.0.1'])('does not mistake %s for LAN', (host) => expect(isPrivateHost(host)).toBe(false));
  it('rejects another app scheme and an incomplete QR', () => {
    expect(() => parsePairing('https://example.com/?code=123')).toThrow();
    expect(() => parsePairing('occ://pair?url=https://x.com&code=1')).toThrow();
  });
});

describe('SSE framing', () => {
  it('handles CRLF, comments, multiline values, and UTF-8 split in any position', () => {
    const bytes = new TextEncoder().encode(': heartbeat\r\nid: 7\r\nevent: message\r\ndata: {"word":"привет",\r\ndata: "ok":true}\r\n\r\n');
    for (let split = 1; split < bytes.length; split++) {
      const parser = new SseDecoder();
      const frames = [...parser.feed(bytes.slice(0, split)), ...parser.feed(bytes.slice(split))];
      expect(frames).toEqual([{ id: '7', event: 'message', data: '{"word":"привет",\n"ok":true}' }]);
    }
  });
  it('keeps Last-Event-ID and ignores null-byte IDs', () => {
    const parser = new SseDecoder();
    expect(parser.feed('id: a\ndata: one\n\nid: x\0z\ndata: two\n\n').map((item) => item.id)).toEqual(['a','a']);
  });
  it('unwraps both legacy and global v2 events', () => {
    expect(decodeEvent({ directory: '/work', payload: { type: 'question.asked', properties: { id: 'q' } } })).toMatchObject({ directory: '/work', type: 'question.asked', properties: { id: 'q' } });
    expect(decodeEvent({ type: 'session.updated', data: { info: { id: 's' } } })?.properties.info).toEqual({ id: 's' });
  });
  it('never places prompts or commands in lock-screen notifications', () => {
    const notification = notificationFor({ type: 'permission.asked', properties: { sessionID: 's1', patterns: ['private password command'], metadata: { secret: 'sensitive' } } });
    expect(JSON.stringify(notification)).not.toMatch(/private|password|sensitive/);
    expect(notification?.sessionID).toBe('s1');
  });
});
