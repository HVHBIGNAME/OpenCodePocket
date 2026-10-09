import { expect, it } from 'vitest';
import { taskSessionID } from '../../src/lib/subagents';
import type { Part } from '../../src/types';

function task(metadata: Record<string, unknown> = {}, output = ''): Extract<Part, { type: 'tool' }> {
  return {
    id: 'p',
    messageID: 'm',
    sessionID: 'ses_parent',
    type: 'tool',
    callID: 'c',
    tool: 'task',
    state: {
      status: 'completed',
      input: {},
      title: 'Audit',
      output,
      metadata,
      time: { start: 0, end: 1 },
    },
  };
}

it('uses the actual task child session rather than its parent metadata', () => {
  expect(taskSessionID(task({ parentSessionId: 'ses_parent', sessionId: 'ses_child' }))).toBe('ses_child');
  expect(taskSessionID(task({ sessionID: 'ses_child' }))).toBe('ses_child');
});
it('supports foreground and background task result formats', () => {
  expect(taskSessionID(task({}, 'task_id: ses_foreground\n<task_result>Done</task_result>'))).toBe(
    'ses_foreground',
  );
  expect(taskSessionID(task({}, '<task id="ses_background" status="running" />'))).toBe('ses_background');
  expect(taskSessionID(task({}, 'Unrelated text mentioning ses_not_a_task'))).toBeUndefined();
  expect(taskSessionID(task({ sessionId: 'https://untrusted.example' }))).toBeUndefined();
});
