import { notificationFor, type ServerEvent } from './protocol';

export class NotificationGate {
  private seen = new Map<string, number>();
  private recent = new Map<string, number>();
  accept(event: ServerEvent, now = Date.now()): boolean {
    const notification = notificationFor(event);
    if (!notification) return false;
    const kind = event.type.startsWith('question.')
      ? 'question'
      : event.type.startsWith('permission.')
        ? 'permission'
        : 'error';
    const id = event.properties.requestID ?? event.properties.id;
    const key =
      typeof id === 'string'
        ? `${kind}:${id}`
        : event.id
          ? `${kind}:${notification.sessionID}:${event.id}`
          : undefined;
    for (const [key, at] of this.seen) if (now - at > 86400000) this.seen.delete(key);
    if (key && this.seen.has(key)) return false;
    if (key) this.seen.set(key, now);
    if (this.seen.size > 2048) this.seen.delete(this.seen.keys().next().value!);
    const channel = `${kind}:${notification.sessionID}`;
    const last = this.recent.get(channel);
    const cooldown = kind === 'error' ? 60000 : key ? 0 : 10000;
    if (last !== undefined && now - last < cooldown) return false;
    this.recent.set(channel, now);
    if (this.recent.size > 2048) this.recent.delete(this.recent.keys().next().value!);
    return true;
  }
}
