import { describe, expect, it, vi } from 'vitest';

import { PluginManager } from './PluginManager.js';
import type { EnginePlugin } from './EnginePlugin.js';
import { builtInPlugins } from '../built-in/index.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('PluginManager', () => {
  it('initializes plugins by dependency order and exposes registered capabilities', async () => {
    const initOrder: string[] = [];

    const alpha: EnginePlugin = {
      name: 'alpha',
      version: '1.0.0',
      initialize: async (context) => {
        initOrder.push('alpha');
        context.registerTool('alphaTool', { name: 'alphaTool' });
        context.registerService('alphaService', { ready: true });
        context.registerHook('beforeRun', async () => undefined);
      },
    };

    const beta: EnginePlugin = {
      name: 'beta',
      version: '1.0.0',
      dependencies: ['alpha'],
      initialize: async (context) => {
        initOrder.push('beta');
        expect(context.getTool('alphaTool')).toEqual({ name: 'alphaTool' });
      },
    };

    const manager = new PluginManager(createLogger());

    await manager.initialize({
      enginePlugins: {
        plugins: [beta, alpha],
        scan: false,
      },
      userConfigPlugins: {
        scan: false,
      },
    });

    expect(initOrder).toEqual(['alpha', 'beta']);
    expect(manager.getTools()).toEqual(expect.objectContaining({ alphaTool: { name: 'alphaTool' } }));
    expect(manager.getService<{ ready: boolean }>('alphaService')).toEqual({ ready: true });
    expect(manager.getHooks('beforeRun')).toHaveLength(1);

    const status = manager.getStatus();
    expect(status.enginePlugins).toEqual(['alpha', 'beta']);
    expect(status.tools).toContain('alphaTool');
    expect(status.services).toContain('alphaService');
    expect(status.hooks.beforeRun).toBe(1);
    expect(status.hooks.onCompacted).toBe(0);
  });

  it('throws when dependency is missing', async () => {
    const brokenPlugin: EnginePlugin = {
      name: 'broken',
      version: '1.0.0',
      dependencies: ['not-found'],
      initialize: async () => undefined,
    };

    const manager = new PluginManager(createLogger());

    await expect(
      manager.initialize({
        enginePlugins: {
          plugins: [brokenPlugin],
          scan: false,
        },
        userConfigPlugins: {
          scan: false,
        },
      }),
    ).rejects.toThrow('Dependency not found: not-found');
  });

  it('throws for circular dependencies', async () => {
    const pluginA: EnginePlugin = {
      name: 'plugin-a',
      version: '1.0.0',
      dependencies: ['plugin-b'],
      initialize: async () => undefined,
    };

    const pluginB: EnginePlugin = {
      name: 'plugin-b',
      version: '1.0.0',
      dependencies: ['plugin-a'],
      initialize: async () => undefined,
    };

    const manager = new PluginManager(createLogger());

    await expect(
      manager.initialize({
        enginePlugins: {
          plugins: [pluginA, pluginB],
          scan: false,
        },
        userConfigPlugins: {
          scan: false,
        },
      }),
    ).rejects.toThrow('Circular dependency detected');
  });

  // Guards the real built-in plugin array. Every Engine-construction test sets
  // disableBuiltInPlugins:true and the other cases above use synthetic
  // alpha/beta plugins, so the actual builtInPlugins dependency edges
  // (agent-teams -> sub-agent, task-tracking -> built-in-skills) were never
  // exercised — a misspelled dependency name aborts the entire Engine build
  // at construction for every host, and nothing caught it until runtime.
  it('every built-in plugin dependency resolves to a real built-in plugin name', () => {
    const names = new Set(builtInPlugins.map((plugin) => plugin.name));
    expect(names.size).toBe(builtInPlugins.length); // no duplicate names
    for (const plugin of builtInPlugins) {
      for (const dep of plugin.dependencies ?? []) {
        expect(names, `${plugin.name} declares dependency "${dep}"`).toContain(dep);
      }
    }
  });
});
