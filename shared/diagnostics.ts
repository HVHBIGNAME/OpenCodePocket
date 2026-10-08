import { z } from 'zod';

export const DiagnosticSchema = z
  .object({
    schema: z.literal(1),
    id: z.string().uuid(),
    timestamp: z.number().int().positive(),
    version: z
      .string()
      .max(32)
      .regex(/^[0-9a-zA-Z.+-]+$/),
    platform: z.enum(['android', 'ios', 'web']),
    kind: z.enum(['startup', 'unhandled', 'request', 'action', 'native-crash', 'test']),
    severity: z.enum(['warning', 'error', 'fatal']),
    name: z
      .string()
      .max(80)
      .regex(/^[a-zA-Z0-9_.$-]+$/),
    operation: z.enum([
      'startup',
      'sync',
      'connect',
      'send',
      'answer',
      'permissions',
      'models',
      'files',
      'voice',
      'notifications',
      'storage',
      'unknown',
    ]),
    screen: z.enum(['startup', 'overview', 'sessions', 'chat', 'models', 'inbox', 'settings', 'unknown']),
    frames: z
      .array(
        z
          .string()
          .max(160)
          .regex(/^[a-zA-Z0-9_.$<>:@()\- +/]+$/),
      )
      .max(12),
    httpStatus: z.number().int().min(100).max(599).optional(),
    osVersion: z
      .string()
      .max(40)
      .regex(/^[a-zA-Z0-9. -]+$/)
      .optional(),
  })
  .strict();

export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const DiagnosticBatchSchema = z.object({ reports: z.array(DiagnosticSchema).min(1).max(20) }).strict();
export type DiagnosticSummary = {
  enabled: boolean;
  repository: string;
  pending: number;
  groups: number;
  lastDelivery?: number;
  lastError?: string;
  reports: {
    fingerprint: string;
    kind: string;
    name: string;
    count: number;
    version: string;
    platform: string;
    lastSeen: number;
    issueURL?: string;
  }[];
};

export function diagnosticOperation(path: string): Diagnostic['operation'] {
  if (path.includes('prompt_async') || path.endsWith('/command')) return 'send';
  if (path.startsWith('/question')) return 'answer';
  if (path.startsWith('/permission')) return 'permissions';
  if (/^\/(provider|auth|config)/.test(path) || path === '/global/config') return 'models';
  if (/^\/(file|find)/.test(path) || path.endsWith('/diff')) return 'files';
  return 'sync';
}

const safeErrorNames = new Set([
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'RangeError',
  'URIError',
  'AbortError',
  'TimeoutError',
  'ApiError',
  'SecurityError',
  'QuotaExceededError',
]);

/** Only code locations are retained: no error messages, URLs, query strings, or arbitrary context. */
export function errorShape(error: unknown): { name: string; frames: string[]; httpStatus?: number } {
  if (!error || typeof error !== 'object') return { name: 'Error', frames: [] };
  const object = error as Record<string, unknown>;
  const name = typeof object.name === 'string' && safeErrorNames.has(object.name) ? object.name : 'Error';
  const frames: string[] = [];
  if (typeof object.stack === 'string') {
    for (const line of object.stack.split('\n').slice(1)) {
      const match = line.match(/(?:[/\\]|\()([a-zA-Z0-9_.-]+\.(?:js|mjs|ts|tsx|jsx)):(\d+):(\d+)/);
      if (match) frames.push(`${match[1]}:${match[2]}:${match[3]}`);
      if (frames.length >= 12) break;
    }
  }
  const httpStatus =
    typeof object.status === 'number' &&
    Number.isInteger(object.status) &&
    object.status >= 100 &&
    object.status <= 599
      ? object.status
      : undefined;
  return { name, frames, ...(httpStatus ? { httpStatus } : {}) };
}
