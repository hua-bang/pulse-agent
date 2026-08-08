import { describe, expect, it } from 'vitest';

import { BashTool } from './bash';

describe('BashTool', () => {
  it('aborts the command process group', async () => {
    const controller = new AbortController();
    const execution = BashTool.execute(
      {
        command: `${process.execPath} -e "setInterval(() => {}, 1000)"`,
        timeout: 10_000,
      },
      { abortSignal: controller.signal },
    );

    setTimeout(() => controller.abort(), 50);

    await expect(execution).resolves.toMatchObject({
      error: expect.stringContaining('Command aborted'),
    });
  });
});
