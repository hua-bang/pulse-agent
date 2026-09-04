import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), statSync: vi.fn() }));

vi.mock('child_process', () => ({ exec: mocks.exec }));
vi.mock('fs', () => ({ statSync: mocks.statSync }));

import {
  INTEGRATION_VERIFY_TIMEOUT_MS,
  TASK_VERIFY_TIMEOUT_MS,
  runTaskVerification,
} from './verification';

describe('agent team verification options', () => {
  it('uses a valid cwd, task timeout, and bounded output buffer', async () => {
    mocks.statSync.mockReturnValue({ isDirectory: () => true });
    mocks.exec.mockImplementation((_command, options, callback) => {
      expect(options).toMatchObject({
        cwd: '/workspace',
        timeout: TASK_VERIFY_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      callback(null, 'ok', '');
    });

    await expect(runTaskVerification('verify', '/workspace')).resolves.toMatchObject({
      ok: true,
      exitCode: 0,
    });
  });

  it('drops an invalid cwd and maps nonnumeric timeout errors to a null exit code', async () => {
    mocks.statSync.mockImplementation(() => { throw new Error('missing'); });
    mocks.exec.mockImplementation((_command, options, callback) => {
      expect(options).toMatchObject({
        cwd: undefined,
        timeout: INTEGRATION_VERIFY_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      callback(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), '', 'timeout');
    });

    await expect(runTaskVerification(
      'verify',
      '/missing',
      INTEGRATION_VERIFY_TIMEOUT_MS,
    )).resolves.toMatchObject({
      ok: false,
      exitCode: null,
      outputTail: 'timeout',
    });
  });
});
