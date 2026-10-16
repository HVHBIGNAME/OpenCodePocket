import type { ServerEvent } from '../../shared/protocol';

/** Preserves event order while limiting streaming renders to one batch per 80 ms. */
export function eventBatch(deliver: (events: ServerEvent[]) => void) {
  let pending: ServerEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    const events = pending;
    pending = [];
    deliver(events);
  };
  return {
    push(event: ServerEvent) {
      pending.push(event);
      if (!event.type.startsWith('message.') || pending.length >= 256) flush();
      else timer ??= setTimeout(flush, 80);
    },
    flush,
    clear() {
      clearTimeout(timer);
      timer = undefined;
      pending = [];
    },
  };
}
