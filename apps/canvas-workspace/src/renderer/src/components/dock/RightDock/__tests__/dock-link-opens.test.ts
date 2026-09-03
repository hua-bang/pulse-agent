// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkOpenRequest } from '../../../../../../shared/link-open';
import {
  registerMountedWebviewIdentity,
} from '../../../../modules/canvas/webview';
import { routeDockLinkOpen } from '../useDockLinkOpens';
import { DockStore } from '../dock-store';

const request = (overrides: Partial<LinkOpenRequest> = {}): LinkOpenRequest => ({
  url: 'https://opened.example/',
  sourceWebContentsId: 42,
  source: {
    workspaceId: 'ws-a',
    nodeId: 'node-a',
    webContentsId: 42,
    surfaceKind: 'canvas-node',
  },
  ...overrides,
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('routeDockLinkOpen', () => {
  it('routes an inactive canvas-node link to its owning workspace', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    store.setActiveWorkspace('ws-b');
    cleanups.push(registerMountedWebviewIdentity(request().source!));

    expect(routeDockLinkOpen(store, request())).toBe(true);
    expect(store.getSnapshot().tabs).toHaveLength(0);

    store.setActiveWorkspace('ws-a');
    expect(store.getSnapshot().tabs).toMatchObject([
      { kind: 'link', url: 'https://opened.example/' },
    ]);
  });

  it('rejects a stale guest generation instead of applying its opener identity', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    cleanups.push(registerMountedWebviewIdentity({
      ...request().source!,
      webContentsId: 99,
    }));

    expect(routeDockLinkOpen(store, request())).toBe(false);
    expect(store.getSnapshot().tabs).toHaveLength(0);
  });

  it('rejects an unidentified guest instead of guessing the visible workspace', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-b');

    expect(routeDockLinkOpen(store, {
      url: 'https://unknown.example/',
      sourceWebContentsId: 42,
    })).toBe(false);
    expect(store.getSnapshot().tabs).toHaveLength(0);
  });

  it('rejects a payload whose legacy guest id disagrees with its full identity', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-a');
    cleanups.push(registerMountedWebviewIdentity(request().source!));

    expect(routeDockLinkOpen(store, request({ sourceWebContentsId: 99 }))).toBe(false);
    expect(store.getSnapshot().tabs).toHaveLength(0);
  });
});
