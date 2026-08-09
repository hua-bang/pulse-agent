import { describe, expect, it, vi } from 'vitest';

import { createJsExecutor } from './executor.js';
import { createRunJsTool } from './tool.js';

describe('createRunJsTool', () => {
  it('uses defaults and forwards execution to executor', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      result: 3,
      stdout: '',
      stderr: '',
      durationMs: 1,
      outputTruncated: false
    });

    const tool = createRunJsTool({
      executor: { execute }
    });

    expect(tool.name).toBe('run_js');
    expect(tool.description).toContain('Execute JavaScript');

    const payload = { code: 'return 1 + 2;' };
    const output = await tool.execute(payload);

    expect(execute).toHaveBeenCalledWith(payload, undefined);
    expect(output.ok).toBe(true);
  });

  it('forwards the tool abort signal to the executor', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: '',
      durationMs: 1,
      outputTruncated: false,
      error: { code: 'INTERNAL', message: 'Execution aborted.' },
    });
    const controller = new AbortController();
    const tool = createRunJsTool({ executor: { execute } });

    await tool.execute({ code: 'return 1;' }, { abortSignal: controller.signal });

    expect(execute).toHaveBeenCalledWith({ code: 'return 1;' }, controller.signal);
  });
});

describe('createJsExecutor', () => {
  it('returns POLICY_BLOCKED for invalid timeout or empty code', async () => {
    const executor = createJsExecutor();

    const invalidTimeout = await executor.execute({ code: 'return 1;', timeoutMs: 0 });
    expect(invalidTimeout.ok).toBe(false);
    expect(invalidTimeout.error?.code).toBe('POLICY_BLOCKED');

    const emptyCode = await executor.execute({ code: '   ' });
    expect(emptyCode.ok).toBe(false);
    expect(emptyCode.error?.code).toBe('POLICY_BLOCKED');
  });

  it('does not start a sandbox process when already aborted', async () => {
    const executor = createJsExecutor({ timeoutMs: 10_000 });
    const controller = new AbortController();
    controller.abort();

    await expect(executor.execute({ code: 'while (true) {}' }, controller.signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'Execution aborted.' },
    });
  });
});
