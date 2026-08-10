/** IPC wire contract between the executor (host) and the forked runner,
 *  plus the output-limiting helpers both sides clamp with. */

export interface RunnerRequest {
  code: string;
  input: unknown;
  maxOutputChars: number;
}

export interface RunnerSuccessMessage {
  type: 'success';
  result: unknown;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export interface RunnerErrorMessage {
  type: 'error';
  errorCode: 'RUNTIME_ERROR' | 'INTERNAL';
  errorMessage: string;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export type RunnerMessage = RunnerSuccessMessage | RunnerErrorMessage;

export function appendWithLimit(buffer: string, chunk: string, maxChars: number): { value: string; truncated: boolean } {
  const merged = buffer + chunk;

  if (merged.length <= maxChars) {
    return { value: merged, truncated: false };
  }

  return {
    value: merged.slice(0, maxChars),
    truncated: true
  };
}

export function clampText(value: string, maxChars: number): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }

  return {
    value: value.slice(0, maxChars),
    truncated: true
  };
}

export function mergeText(first: string, second: string): string {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return `${first}\n${second}`;
}
