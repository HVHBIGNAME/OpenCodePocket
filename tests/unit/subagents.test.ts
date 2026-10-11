import { expect, it } from 'vitest';
import { taskSessionID, taskPhase, taskResult } from '../../src/lib/subagents';
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
  expect(taskSessionID(task({ sessionId: 'ses_parent' }))).toBeUndefined();
  expect(taskSessionID(task({}, 'task_id: ses_parent'))).toBeUndefined();
});

it('keeps a finished foreground task finished when its child is reused', () => {
  expect(
    taskPhase(task({}, 'task_id: ses_child\n<task_result>Done</task_result>'), { type: 'busy' }, true),
  ).toBe('Завершена');
  const background = task({}, '<task id="ses_child" status="running" />');
  expect(taskPhase(background)).toBe('В фоне');
  expect(taskPhase(background, { type: 'busy' })).toBe('В работе');
  expect(taskPhase(background, { type: 'idle' })).toBe('Завершена');
  expect(taskPhase(background, undefined, true)).toBe('Ждёт ответа');
  expect(taskPhase(background, { type: 'retry', attempt: 1, message: 'Retry', next: 100 })).toBe(
    'Повтор запроса',
  );
});

it('distinguishes queued, cancelled and failed tasks and hides transport wrappers', () => {
  const part = task();
  part.state = { status: 'pending', input: {}, raw: '' };
  expect(taskPhase(part)).toBe('В очереди');
  part.state = { status: 'error', input: {}, error: 'Request cancelled', time: { start: 0, end: 1 } };
  expect(taskPhase(part)).toBe('Отменена');
  part.state.error = 'Provider error';
  expect(taskPhase(part)).toBe('Ошибка');
  expect(taskResult('task_id: ses_child (resume)\n<task_result>**Done**\nDetails</task_result>')).toBe(
    '**Done**\nDetails',
  );
  expect(taskResult('<task id="ses_child" status="running" />')).toBe('');
});
it('supports foreground and background task result formats', () => {
  expect(taskSessionID(task({}, 'task_id: ses_foreground\n<task_result>Done</task_result>'))).toBe(
    'ses_foreground',
  );
  expect(taskSessionID(task({}, '<task id="ses_background" status="running" />'))).toBe('ses_background');
  expect(taskSessionID(task({}, 'Unrelated text mentioning ses_not_a_task'))).toBeUndefined();
  expect(taskSessionID(task({ sessionId: 'https://untrusted.example' }))).toBeUndefined();
});
