export function timeAgo(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'сейчас';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  if (hours < 48) return 'вчера';
  return new Date(timestamp).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}
export function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}
export const number = (value: number) =>
  new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const money = (value: number) => `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
export const clock = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
