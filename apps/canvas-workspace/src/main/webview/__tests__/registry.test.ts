import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Generation guards for the webview registry: a node key can be re-bound to
 * a NEW webContents (wake-from-discard remount, url-mode flip) while the OLD
 * guest's renderer teardown / destroyed event is still in flight. Unregister
 * is compare-and-delete on webContentsId and destroyed guests self-heal, so
 * a stale generation can never evict a newer one.
 */

interface FakeWebContents {
  id: number;
  destroyed: boolean;
  destroyedHooks: Array<() => void>;
  isDestroyed: () => boolean;
  once: (event: string, cb: () => void) => void;
  /** register() also hooks `before-input-event` for shortcut forwarding. */
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emitDestroyed: () => void;
  setFrameRate: ReturnType<typeof vi.fn>;
}

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  contents: new Map<number, unknown>(),
}));

vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler);
    },
  },
  webContents: {
    fromId: (id: number) => electron.contents.get(id) ?? null,
  },
}));

import {
  getWebContentsForNode,
  getWebContentsForInstance,
  getWebviewRegistration,
  getWebviewSurfaceKind,
  setupWebviewRegistryIpc,
} from '../registry';

const makeWc = (id: number): FakeWebContents => {
  const wc: FakeWebContents = {
    id,
    destroyed: false,
    destroyedHooks: [],
    isDestroyed: () => wc.destroyed,
    once: (event, cb) => {
      if (event === 'destroyed') wc.destroyedHooks.push(cb);
    },
    on: () => undefined,
    emitDestroyed: () => {
      wc.destroyed = true;
      for (const cb of wc.destroyedHooks) cb();
    },
    setFrameRate: vi.fn(),
  };
  return wc;
};

const invoke = (channel: string, payload: unknown): unknown => {
  const handler = electron.handlers.get(channel);
  expect(handler, `handler for ${channel}`).toBeTypeOf('function');
  return handler?.({}, payload);
};

const registerNode = (
  webContentsId: number,
  nodeId = 'node-1',
  surfaceKind?: 'canvas-node' | 'dock-browser',
): unknown => invoke('iframe:register-webview', {
  workspaceId: 'ws-1',
  nodeId,
  webContentsId,
  ...(surfaceKind ? { surfaceKind } : {}),
});

let wc101: FakeWebContents;
let wc202: FakeWebContents;

beforeEach(() => {
  electron.handlers.clear();
  electron.contents.clear();
  wc101 = makeWc(101);
  wc202 = makeWc(202);
  electron.contents.set(101, wc101);
  electron.contents.set(202, wc202);
  setupWebviewRegistryIpc();
  // The registry Map is module state shared across tests: clear the key by
  // unregistering whatever generation currently owns it.
  for (const nodeId of ['node-1', 'dock-tab-1']) {
    for (const id of [101, 202]) {
      invoke('iframe:unregister-webview', { workspaceId: 'ws-1', nodeId, webContentsId: id });
    }
  }
});

describe('webview registry generations', () => {
  it('records an explicit dock-browser surface and defaults legacy registrations to canvas-node', () => {
    registerNode(101);
    registerNode(202, 'dock-tab-1', 'dock-browser');

    expect(getWebviewSurfaceKind(101)).toBe('canvas-node');
    expect(getWebviewSurfaceKind(202)).toBe('dock-browser');
    expect(getWebviewSurfaceKind(999)).toBeNull();
    expect(getWebviewRegistration(202)).toEqual({
      workspaceId: 'ws-1',
      nodeId: 'dock-tab-1',
      webContentsId: 202,
      surfaceKind: 'dock-browser',
    });
    expect(getWebviewRegistration(999)).toBeNull();
  });

  it('returns a complete non-retryable lifecycle result for invalid payloads', async () => {
    await expect(invoke('iframe:set-lifecycle', { workspaceId: 'ws-1' })).resolves.toEqual({
      ok: false,
      retryable: false,
      error: 'invalid lifecycle payload',
    });
  });

  it('does not let an old guest unregister a newer replacement', () => {
    registerNode(101);
    registerNode(202);

    expect(getWebviewRegistration(101)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 101,
    });
    expect(getWebviewRegistration(202)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      surfaceKind: 'canvas-node',
    });
    invoke('iframe:unregister-webview', { workspaceId: 'ws-1', nodeId: 'node-1', webContentsId: 101 });
    expect(getWebviewRegistration(101)).toBeNull();
    expect(getWebContentsForNode('ws-1', 'node-1')).toMatchObject({ id: 202 });

    invoke('iframe:unregister-webview', { workspaceId: 'ws-1', nodeId: 'node-1', webContentsId: 202 });
    expect(getWebContentsForNode('ws-1', 'node-1')).toBeNull();
    expect(getWebviewRegistration(202)).toBeNull();
  });

  it('keeps full identities for two mounted presentations of the same node', () => {
    registerNode(101);
    registerNode(202);

    expect(getWebviewRegistration(101)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 101,
      surfaceKind: 'canvas-node',
    });
    expect(getWebviewRegistration(202)).toMatchObject({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 202,
      surfaceKind: 'canvas-node',
    });

    // Node-oriented consumers use the newest presentation, but removing it
    // promotes the still-mounted older presentation instead of losing both.
    expect(getWebContentsForNode('ws-1', 'node-1')).toMatchObject({ id: 202 });
    invoke('iframe:unregister-webview', {
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 202,
    });
    expect(getWebContentsForNode('ws-1', 'node-1')).toMatchObject({ id: 101 });
  });

  it('targets lifecycle controls at the exact presentation, never the newest node alias', () => {
    registerNode(101);
    registerNode(202);

    expect(getWebContentsForInstance({
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 101,
    })).toBe(wc101);
    expect(invoke('iframe:set-frame-rate', {
      workspaceId: 'ws-1',
      nodeId: 'node-1',
      webContentsId: 101,
      frameRate: 1,
    })).toEqual({ ok: true, frameRate: 1 });
    expect(wc101.setFrameRate).toHaveBeenCalledWith(1);
    expect(wc202.setFrameRate).not.toHaveBeenCalled();

    expect(invoke('iframe:set-frame-rate', {
      workspaceId: 'ws-1',
      nodeId: 'other-node',
      webContentsId: 101,
      frameRate: 1,
    })).toEqual({ ok: false });
  });

  it('rejects an unregister without a webContentsId instead of blind-deleting', () => {
    registerNode(101);
    const result = invoke('iframe:unregister-webview', { workspaceId: 'ws-1', nodeId: 'node-1' });
    expect(result).toEqual({ ok: false });
    expect(getWebContentsForNode('ws-1', 'node-1')).toMatchObject({ id: 101 });
  });

  it('auto-unregisters when the guest is destroyed without a renderer teardown', () => {
    registerNode(101);
    expect(wc101.destroyedHooks.length).toBe(1);

    wc101.emitDestroyed();
    // Prove the ENTRY is gone (not just that the wc is dead): plant a live
    // impostor at the same id — a lingering entry would resolve to it.
    electron.contents.set(101, makeWc(101));
    expect(getWebContentsForNode('ws-1', 'node-1')).toBeNull();
  });

  it("an old generation's destroyed event does not evict the newer registration", () => {
    registerNode(101);
    registerNode(202);

    wc101.emitDestroyed();
    expect(getWebContentsForNode('ws-1', 'node-1')).toMatchObject({ id: 202 });
  });

  it('does not stack duplicate destroyed hooks on re-registration of the same guest', () => {
    registerNode(101);
    registerNode(101); // dom-ready re-announce path registers the same id again
    expect(wc101.destroyedHooks.length).toBe(1);
  });

  it('self-heals a destroyed entry on lookup', () => {
    registerNode(101);
    wc101.destroyed = true; // died without the destroyed event reaching us

    expect(getWebContentsForNode('ws-1', 'node-1')).toBeNull();

    // The dead entry was removed on that lookup: reviving the id must NOT
    // resurrect the mapping.
    wc101.destroyed = false;
    expect(getWebContentsForNode('ws-1', 'node-1')).toBeNull();
  });

  it('falls back immediately when the newest presentation died silently', () => {
    registerNode(101);
    registerNode(202);
    wc202.destroyed = true;

    expect(getWebContentsForNode('ws-1', 'node-1')).toBe(wc101);
  });
});
