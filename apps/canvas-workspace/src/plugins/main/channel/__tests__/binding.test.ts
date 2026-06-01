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

  it('explicit per-chat binding wins over the default', async () => {
    const b = new BindingStore(memoryStore());
    await b.setDefault('ws-default');
    await b.bind(CH, 'chatA', 'ws-A');
    expect(await b.resolve(CH, 'chatA')).toBe('ws-A');
    // A different chat with no explicit binding falls back to the default.
    expect(await b.resolve(CH, 'chatB')).toBe('ws-default');
  });

  it('unbind removes the override and falls back to the default', async () => {
    const b = new BindingStore(memoryStore());
    await b.setDefault('ws-default');
    await b.bind(CH, 'chatA', 'ws-A');
    await b.unbind(CH, 'chatA');
    expect(await b.getExplicit(CH, 'chatA')).toBeUndefined();
    expect(await b.resolve(CH, 'chatA')).toBe('ws-default');
  });

  it('env var is used when there is no explicit or stored default', async () => {
    process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = 'ws-env';
    const b = new BindingStore(memoryStore());
    expect(await b.resolve(CH, 'chatX')).toBe('ws-env');
  });

  it('stored default takes precedence over the env var', async () => {
    process.env.CANVAS_FEISHU_DEFAULT_WORKSPACE = 'ws-env';
    const b = new BindingStore(memoryStore());
    await b.setDefault('ws-stored');
    expect(await b.resolve(CH, 'chatX')).toBe('ws-stored');
  });

  it('persists across instances backed by the same store', async () => {
    const store = memoryStore();
    const b1 = new BindingStore(store);
    await b1.bind(CH, 'chatA', 'ws-A');
    await b1.setDefault('ws-default');

    const b2 = new BindingStore(store);
    expect(await b2.resolve(CH, 'chatA')).toBe('ws-A');
    expect(await b2.getDefault()).toBe('ws-default');
  });
});
