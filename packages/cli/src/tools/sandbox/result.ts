import type { JsExecutionErrorCode, JsExecutionResult } from './types.js';

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function inferExitErrorCode(signal: NodeJS.Signals | null, stderr: string): JsExecutionErrorCode {
  if (signal === 'SIGABRT' || /heap out of memory/i.test(stderr)) {
    return 'OOM';
  }

  return 'INTERNAL';
}

export function createErrorResult(
  startedAt: number,
  stdout: string,
  stderr: string,
  errorCode: JsExecutionErrorCode,
  errorMessage: string,
  outputTruncated: boolean
): JsExecutionResult {
  return {
    ok: false,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    outputTruncated,
    error: {
      code: errorCode,
      message: errorMessage
    }
  };
}
