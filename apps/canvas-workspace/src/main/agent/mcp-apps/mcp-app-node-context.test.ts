import { describe, expect, it } from 'vitest';
import { McpAppNodeContextStore } from './mcp-app-node-context';

const target = {
  workspaceId: 'ws-1', nodeId: 'node-1', serverName: 'bits-and-bolts',
  toolName: 'cad.library', resourceUri: 'ui://bits/app',
};
const content = (text: string) => ({ content: [{ type: 'text', text }] });

describe('MCP App node context leases', () => {
  it('keeps latest visible and model state separate from the opening data', () => {
    const store = new McpAppNodeContextStore();
    const token = store.open(1, target);
    store.update(1, token, 'tool-result', { structuredContent: { parts: ['keycap', 'dial'] } });
    store.update(1, token, 'visible-ui', content('Parts Library: keycap'));
    store.update(1, token, 'model-context', { structuredContent: { part: 'keycap', selection: 'top' } });
    store.update(1, token, 'visible-ui', content('Viewer: keycap'));
    expect(store.read(target)).toContain('Viewer: keycap');
    expect(store.read(target)).not.toContain('Parts Library: keycap');
    expect(store.read(target)).toContain('"selection":"top"');
    expect(store.read(target)).toContain('tool-result');
    expect(store.read({ ...target, workspaceId: 'ws-2' })).toBeUndefined();
    expect(store.read({ ...target, resourceUri: 'ui://other/app' })).toBeUndefined();
  });

  it('rejects cross-renderer and stale publications without clearing a replacement mount', () => {
    const store = new McpAppNodeContextStore();
    const old = store.open(1, target);
    expect(() => store.update(2, old, 'visible-ui', content('wrong'))).toThrow('expired');
    const current = store.open(1, target);
    expect(() => store.update(1, old, 'visible-ui', content('stale'))).toThrow('expired');
    store.update(1, current, 'visible-ui', content('current'));
    store.close(1, old);
    expect(store.read(target)).toContain('current');
    store.clearSender(1);
    expect(store.read(target)).toBeUndefined();
  });

  it('bounds text snapshots, ignores binary data, and allows an empty update to clear model state', () => {
    const store = new McpAppNodeContextStore();
    const token = store.open(1, target);
    expect(() => store.update(1, token, 'visible-ui', content('界'.repeat(30_000)))).toThrow('64 KiB');
    store.update(1, token, 'model-context', {
      content: [{ type: 'image', data: 'secret-base64' }, { type: 'text', text: 'selected dial' }],
    });
    expect(store.read(target)).toContain('selected dial');
    expect(store.read(target)).not.toContain('secret-base64');
    store.update(1, token, 'model-context', {});
    expect(store.read(target)).toBeUndefined();
  });
});
