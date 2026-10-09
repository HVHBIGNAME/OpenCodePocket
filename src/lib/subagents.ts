import type { Part } from '../types';

export function taskSessionID(part: Extract<Part, { type: 'tool' }>): string | undefined {
  const metadata = 'metadata' in part.state ? part.state.metadata : undefined;
  for (const value of [
    metadata?.sessionId,
    metadata?.sessionID,
    metadata?.session_id,
    part.state.input.task_id,
  ]) {
    if (typeof value === 'string' && /^ses_[\w-]+$/.test(value)) return value;
  }
  if (part.state.status !== 'completed') return;
  return (
    part.state.output.match(/<task\s+id=["'](ses_[\w-]+)["']/)?.[1] ??
    part.state.output.match(/task_id:\s*(ses_[\w-]+)/)?.[1]
  );
}
