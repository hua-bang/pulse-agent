import { describe, expect, it } from 'vitest';

import { printModeExitCode } from './print-mode.js';

describe('printModeExitCode', () => {
  it('maps benchmark termination reasons to stable process exit codes', () => {
    expect(printModeExitCode('completed')).toBe(0);
    expect(printModeExitCode('error')).toBe(1);
    expect(printModeExitCode('timeout')).toBe(124);
    expect(printModeExitCode('signal', 'SIGINT')).toBe(130);
    expect(printModeExitCode('signal', 'SIGTERM')).toBe(143);
    expect(printModeExitCode('token_budget')).toBe(2);
    expect(printModeExitCode('max_steps')).toBe(2);
  });
});
