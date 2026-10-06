import { describe, expect, it } from 'vitest';
import { GlobalMcpAppsStore, globalMcpAppKey } from '../globalMcpAppsStore';

const listing = (toolName: string) => ({
  serverName: 'mock', toolName, resourceUri: `ui://${toolName}`, title: toolName, kind: 'global' as const,
});
const content = (text: string) => ({ content: [{ type: 'text', text }] });

describe('global App view context', () => {
  it('replaces source snapshots and includes only the shown app, preserving frozen turns', () => {
    const store = new GlobalMcpAppsStore();
    store.open(listing('a'));
    store.open(listing('b'));
    const [a, b] = store.getSnapshot().running;
    store.publishContext(a, 'tool-result', content('all six'));
    store.publishContext(a, 'visible-ui', content('filter: today'));
    store.publishContext(b, 'visible-ui', content('another app'));
    store.setActive(a.key);
    const frozen = store.readActiveContext();
    store.publishContext(a, 'visible-ui', content('filter: architecture'));
    expect(frozen?.snapshots.map(value => value.text)).toEqual(['all six', 'filter: today']);
    expect(store.readActiveContext()?.snapshots.map(value => value.text)).toEqual(['all six', 'filter: architecture']);
    store.setActive(b.key);
    expect(store.readActiveContext()?.snapshots.map(value => value.text)).toEqual(['another app']);
    store.setActive(null);
    expect(store.readActiveContext()).toBeNull();
  });

  it('rejects publications from closed/reloaded instances and clears on teardown', () => {
    const store = new GlobalMcpAppsStore();
    const item = listing('a');
    store.open(item);
    const old = store.getSnapshot().running[0];
    store.setActive(old.key);
    store.publishContext(old, 'model-context', { structuredContent: { selected: 'first' } });
    store.reload(old.key);
    store.publishContext(old, 'visible-ui', content('late old frame'));
    expect(store.readActiveContext()?.snapshots).toEqual([]);
    const current = store.getSnapshot().running[0];
    store.publishContext(current, 'visible-ui', content('new frame'));
    store.clearContext(old);
    expect(store.readActiveContext()?.snapshots[0].text).toBe('new frame');
    store.clearContext(current);
    expect(store.readActiveContext()?.snapshots).toEqual([]);
    store.close(current.key);
    store.open(item);
    store.publishContext(current, 'visible-ui', content('late closed frame'));
    expect(store.readActiveContext()?.snapshots).toEqual([]);
    store.close(globalMcpAppKey(item));
    expect(store.readActiveContext()).toBeNull();
  });

  it('caps UTF-8 text and excludes binary content', () => {
    const store = new GlobalMcpAppsStore();
    store.open(listing('a'));
    const app = store.getSnapshot().running[0];
    store.setActive(app.key);
    expect(() => store.publishContext(app, 'visible-ui', content('界'.repeat(30_000)))).toThrow('64 KiB');
    store.publishContext(app, 'model-context', { content: [{ type: 'image', data: 'secret-base64' }] });
    expect(store.readActiveContext()?.snapshots[0].text).toBe('');
  });
});
