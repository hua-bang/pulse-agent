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

describe('Engine.run model resolution', () => {
  beforeEach(() => {
    loopMock.mockReset();
    loopMock.mockResolvedValue('done');
  });

  const createEngine = (options: Record<string, unknown>) => new Engine({
    disableBuiltInPlugins: true,
    enginePlugins: { scan: false },
    builtInTools: {},
    logger: createLogger(),
    ...options,
  });

  it('forwards a constructor modelType to the loop with its provider', async () => {
    const engine = createEngine({ modelType: 'claude', model: 'claude-x' });
    await engine.initialize();

    await engine.run({ messages: [{ role: 'user', content: 'hi' }] });

    const loopOptions = loopMock.mock.calls[0][1];
    expect(loopOptions.modelType).toBe('claude');
    expect(loopOptions.model).toBe('claude-x');
    expect(typeof loopOptions.provider).toBe('function');
  });

  it('lets a per-run modelType override the constructor default', async () => {
    const engine = createEngine({ modelType: 'claude' });
    await engine.initialize();

    await engine.run({ messages: [{ role: 'user', content: 'hi' }] }, { modelType: 'openai' });

    expect(loopMock.mock.calls[0][1].modelType).toBe('openai');
  });
});
