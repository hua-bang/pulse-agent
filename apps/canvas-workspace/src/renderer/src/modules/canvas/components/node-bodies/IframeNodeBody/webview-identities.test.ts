import { describe, expect, it } from 'vitest';
import {
  mountedWebviewIdentityForWebContents,
  registerMountedWebviewIdentity,
} from './webview-identities';

describe('mounted webview identity', () => {
  it('stores the full guest identity and removes it on teardown', () => {
    const identity = {
      workspaceId: 'ws-a',
      nodeId: 'same-url-tab',
      webContentsId: 42,
      surfaceKind: 'dock-browser' as const,
    };

    const unregister = registerMountedWebviewIdentity(identity);
    expect(mountedWebviewIdentityForWebContents(42)).toEqual(identity);

    unregister();
    expect(mountedWebviewIdentityForWebContents(42)).toBeUndefined();
  });

  it('does not let an old teardown remove a replacement guest binding', () => {
    const unregisterOld = registerMountedWebviewIdentity({
      workspaceId: 'ws-a',
      nodeId: 'tab-a',
      webContentsId: 42,
      surfaceKind: 'dock-browser',
    });
    const replacement = {
      workspaceId: 'ws-b',
      nodeId: 'tab-b',
      webContentsId: 42,
      surfaceKind: 'canvas-node' as const,
    };
    const unregisterReplacement = registerMountedWebviewIdentity(replacement);

    unregisterOld();
    expect(mountedWebviewIdentityForWebContents(42)).toEqual(replacement);

    unregisterReplacement();
    expect(mountedWebviewIdentityForWebContents(42)).toBeUndefined();
  });
});
