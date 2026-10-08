export function isGenerationCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'name' in error && error.name === 'MessageAbortedError';
}

export function isAbortedTool(message: string): boolean {
  return /^(?:Error:\s*)?(?:This operation was aborted|The operation was aborted|The user aborted a request|Tool execution aborted|Aborted|Request cancelled|User cancelled)\.?$/i.test(
    message.trim(),
  );
}
