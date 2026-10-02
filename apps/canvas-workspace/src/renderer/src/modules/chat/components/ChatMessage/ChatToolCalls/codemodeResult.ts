import type { ToolCallStatus } from '../../../../../types';

/** Outer tool registered by the Engine Codemode plugin. */
export const CODEMODE_TOOL_NAME = 'codemode';

export type CodemodeCallStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'intercepted'
  | 'failed'
  | 'cancelled';

export interface CodemodeCallView {
  name: string;
  status: CodemodeCallStatus;
  durationMs?: number;
  error?: string;
}

/** Consecutive calls with the same name and outcome, shown as one row. */
export interface CodemodeCallGroup extends CodemodeCallView {
  count: number;
}

export interface CodemodeResultView {
  ok: boolean;
  calls: CodemodeCallView[];
  output: string[];
  value?: unknown;
  hasValue: boolean;
  error?: string;
  failedCalls: number;
}

const CALL_STATUSES = new Set<string>([
  'queued',
  'running',
  'succeeded',
  'intercepted',
  'failed',
  'cancelled',
]);

const toCall = (raw: unknown): CodemodeCallView | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== 'string' || !CALL_STATUSES.has(String(record.status))) return null;
  return {
    name: record.name,
    status: record.status as CodemodeCallStatus,
    ...(typeof record.durationMs === 'number' ? { durationMs: record.durationMs } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
};

/**
 * The Codemode result already carries every nested call, so completed and
 * reloaded turns render their script calls from the persisted tool result.
 */
export function parseCodemodeResult(
  tool: Pick<ToolCallStatus, 'name' | 'result'>,
): CodemodeResultView | null {
  if (tool.name !== CODEMODE_TOOL_NAME || !tool.result) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(tool.result);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { calls?: unknown }).calls)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const calls = (record.calls as unknown[])
    .map(toCall)
    .filter((call): call is CodemodeCallView => call !== null);
  return {
    ok: record.ok === true,
    calls,
    output: Array.isArray(record.output)
      ? record.output.filter((line): line is string => typeof line === 'string')
      : [],
    value: record.value,
    hasValue: Object.prototype.hasOwnProperty.call(record, 'value') && record.value !== undefined,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    failedCalls: calls.filter(call => call.status === 'failed').length,
  };
}

/** Failed calls stay separate so each error remains visible. */
export function groupCodemodeCalls(calls: CodemodeCallView[]): CodemodeCallGroup[] {
  const groups: CodemodeCallGroup[] = [];
  for (const call of calls) {
    const last = groups.at(-1);
    if (last && call.status !== 'failed' && last.name === call.name && last.status === call.status) {
      last.count += 1;
      if (call.durationMs !== undefined) last.durationMs = (last.durationMs ?? 0) + call.durationMs;
      continue;
    }
    groups.push({ ...call, count: 1 });
  }
  return groups;
}

/** Script source from the outer call input, when the model supplied it. */
export function codemodeSource(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const code = (args as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
