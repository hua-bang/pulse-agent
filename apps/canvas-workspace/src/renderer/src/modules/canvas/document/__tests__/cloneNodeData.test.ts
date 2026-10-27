import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../../types';
import { cloneNodeData } from '../cloneNodeData';

const node = (type: CanvasNode['type'], data: CanvasNode['data']): CanvasNode => ({
  id: `${type}-1`, type, title: type, x: 0, y: 0, width: 100, height: 100, data,
});

describe('cloneNodeData', () => {
  it('keeps the page a web node shows', () => {
    const data = { url: 'https://example.com', html: '', mode: 'url' as const, pageTitle: 'Example' };
    const copy = cloneNodeData(node('iframe', data));
    expect(copy).toEqual(data);
    expect(copy).not.toBe(data);
  });

  it('deep-copies a plugin payload', () => {
    const data = { pluginId: 'p', nodeType: 't', payload: { items: [{ id: 'a', done: false }] } };
    const copy = cloneNodeData(node('plugin', data)) as typeof data;
    expect(copy).toEqual(data);
    expect(copy.payload.items).not.toBe(data.payload.items);
  });

  it('gives a terminal its own session but keeps its folder', () => {
    const copy = cloneNodeData(node('terminal', {
      sessionId: 's-1', cwd: '/repo', scrollback: 'old output', initialCommand: 'make',
    }));
    expect(copy).toEqual({ sessionId: '', cwd: '/repo' });
  });

  it('gives an agent its own session but keeps its setup', () => {
    const copy = cloneNodeData(node('agent', {
      sessionId: 's-1', agentType: 'codex', status: 'running', cwd: '/repo',
      agentArgs: '--fast', cliSessionId: 'cli-1', viewMode: 'running',
    }));
    expect(copy).toEqual({ sessionId: '', agentType: 'codex', status: 'idle', cwd: '/repo', agentArgs: '--fast' });
  });

  it('leaves a dynamic app unbound so copies do not share runner state', () => {
    expect(cloneNodeData(node('dynamic-app', { url: 'http://127.0.0.1/app', dynamicAppId: 'app-1' })))
      .toEqual({ url: '', dynamicAppId: '' });
  });

  it('maps group children to the copied ids', () => {
    const copy = cloneNodeData(
      node('group', { childIds: ['a', 'b'] }),
      new Map([['a', 'a2']]),
    );
    expect(copy).toEqual({ childIds: ['a2'] });
  });
});
