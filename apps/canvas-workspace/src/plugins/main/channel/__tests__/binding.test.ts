import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PluginStore } from '../../../types';
import { BindingStore } from '../core/binding';

// Minimal in-memory PluginStore so binding tests never touch disk.
function memoryStore(): PluginStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      map.set(key, value);
    },
    async delete(key: string) {
      map.delete(key);
    },
    async list(prefix?: string) {
      const keys = Array.from(map.keys());
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    },
  };
}

const CH = 'feishu';

describe('BindingStore', () => {
  const prev = process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
  beforeEach(() => {
    delete process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE;
    else process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = prev;
  });

  it('getBound returns only the explicit per-chat binding (no implicit fallback)', async () => {
    const b = new BindingStore(memoryStore());
    await b.setDefault('ws-default');
    await b.bind(CH, 'chatA', 'ws-A');
    expect(await b.getBound(CH, 'chatA')).toBe('ws-A');
    // A different chat is NOT auto-bound to the default — it stays unbound.
    expect(await b.getBound(CH, 'chatB')).toBeUndefined();
  });

  it('unbind leaves the conversation unbound (no fallback)', async () => {
    const b = new BindingStore(memoryStore());
    await b.setDefault('ws-default');
    await b.bind(CH, 'chatA', 'ws-A');
    await b.unbind(CH, 'chatA');
    expect(await b.getBound(CH, 'chatA')).toBeUndefined();
  });

  it('suggested default is stored value, else the env var', async () => {
    process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = 'ws-env';
    const b = new BindingStore(memoryStore());
    expect(await b.getSuggestedDefault()).toBe('ws-env');
    await b.setDefault('ws-stored');
    expect(await b.getSuggestedDefault()).toBe('ws-stored');
  });

  it('persists bindings and the default across instances', async () => {
    const store = memoryStore();
    const b1 = new BindingStore(store);
    await b1.bind(CH, 'chatA', 'ws-A');
    await b1.setDefault('ws-default');

    const b2 = new BindingStore(store);
    expect(await b2.getBound(CH, 'chatA')).toBe('ws-A');
    expect(await b2.getSuggestedDefault()).toBe('ws-default');
  });
});
