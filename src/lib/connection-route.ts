export function connectionRoute(url: string): string {
  const { hostname } = new URL(url);
  const [a, b] = hostname.split('.').map(Number);
  if (a === 127 || hostname === 'localhost' || hostname === '[::1]') return 'Этот компьютер';
  if (a === 100 && b! >= 64 && b! <= 127) return 'VPN / частная сеть';
  if (
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    hostname.endsWith('.local')
  )
    return 'Локальная сеть';
  return 'Интернет / туннель';
}
