import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loopMock } = vi.hoisted(() => ({ loopMock: vi.fn() }));

vi.mock('./core/loop.js', () => ({ loop: loopMock }));

import { Engine } from './Engine.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('Engine.run lifecycle', () => {
  beforeEach(() => {
    loopMock.mockReset();
  });

  it('runs afterRun once and preserves the loop error when throw mode rejects', async () => {
    const providerError = new Error('provider unavailable');
    const afterRun = vi.fn(() => {
      throw new Error('cleanup failed');
    });
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        scan: false,
        plugins: [{
          name: 'test/run-lifecycle',
          version: '1.0.0',
          async initialize(context: any) {
            context.registerHook('afterRun', afterRun);
          },
        }],
      },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      logger: createLogger(),
    });
    await engine.initialize();
    const context = { messages: [{ role: 'user' as const, content: 'hello' }] };
    loopMock.mockRejectedValue(providerError);

    await expect(engine.run(context, { errorMode: 'throw' })).rejects.toBe(providerError);
    expect(afterRun).toHaveBeenCalledTimes(1);
    expect(afterRun).toHaveBeenCalledWith({ context, result: '' });
  });
});
