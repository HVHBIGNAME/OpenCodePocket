import type { Part, SessionStatus } from '../types';

export function taskSessionID(part: Extract<Part, { type: 'tool' }>): string | undefined {
  const metadata = 'metadata' in part.state ? part.state.metadata : undefined;
  for (const value of [
    metadata?.sessionId,
    metadata?.sessionID,
    metadata?.session_id,
    part.state.input.task_id,
  ]) {
    if (typeof value === 'string' && /^ses_[\w-]+$/.test(value) && value !== part.sessionID) return value;
  }
  if (part.state.status !== 'completed') return;
  const id =
    part.state.output.match(/<task\s+id=["'](ses_[\w-]+)["']/)?.[1] ??
    part.state.output.match(/task_id:\s*(ses_[\w-]+)/)?.[1];
  return id !== part.sessionID ? id : undefined;
}

export function taskPhase(part: Extract<Part, { type: 'tool' }>, status?: SessionStatus, waiting = false) {
  if (part.state.status === 'error')
    return /abort|cancel|отмен/i.test(part.state.error) ? 'Отменена' : 'Ошибка';
  if (part.state.status === 'pending') return 'В очереди';
  const background =
    part.state.status === 'completed' &&
    /<task\b[^>]*\bstatus=["'](?:running|pending|queued)["']/i.test(part.state.output);
  // A completed foreground call stays completed even if its child session is
  // subsequently reused. A background launch is not the result of that work.
  if (part.state.status === 'completed' && !background) return 'Завершена';
  if (waiting) return 'Ждёт ответа';
  if (status?.type === 'retry') return 'Повтор запроса';
  if (background)
    return status?.type === 'idle' ? 'Завершена' : status?.type === 'busy' ? 'В работе' : 'В фоне';
  return status?.type === 'idle' ? 'Ожидает результат' : 'В работе';
}

export function taskResult(output: string) {
  return output
    .replace(/^task_id:\s*ses_[\w-]+[^\n]*\n?/gm, '')
    .replace(/<\/?task_result>/g, '')
    .replace(/<task\s+id=["']ses_[\w-]+["'][^>]*\/>/g, '')
    .trim();
}
