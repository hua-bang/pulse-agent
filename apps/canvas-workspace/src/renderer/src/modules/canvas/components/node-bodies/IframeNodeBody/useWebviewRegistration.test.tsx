// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from '../../../../../components/dock/EmbeddedBrowser/types';
import { useWebviewRegistration } from './useWebviewRegistration';
import { mountedWebviewIdentityForWebContents } from './webview-identities';

let host: HTMLDivElement;
let root: Root;
let registerWebview: ReturnType<typeof vi.fn>;
let unregisterWebview: ReturnType<typeof vi.fn>;

const webview = Object.assign(new EventTarget(), {
  getWebContentsId: () => 42,
}) as EmbeddedWebviewTag;

beforeEach(() => {
  registerWebview = vi.fn().mockResolvedValue({ ok: true });
  unregisterWebview = vi.fn().mockResolvedValue({ ok: true });
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { iframe: { registerWebview, unregisterWebview } },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(window, 'canvasWorkspace');
});

describe('useWebviewRegistration', () => {
  it('registers the caller-selected surface kind on attach and ready announcements', async () => {
    flushSync(() => root.render(<Harness surfaceKind="dock-browser" />));
    await flushEffects();

    expect(registerWebview).toHaveBeenCalledWith(
      'workspace-1',
      'dock-tab-1',
      42,
      'dock-browser',
    );
    expect(mountedWebviewIdentityForWebContents(42)).toEqual({
      workspaceId: 'workspace-1',
      nodeId: 'dock-tab-1',
      webContentsId: 42,
      surfaceKind: 'dock-browser',
    });

    webview.dispatchEvent(new Event('dom-ready'));
    expect(registerWebview).toHaveBeenLastCalledWith(
      'workspace-1',
      'dock-tab-1',
      42,
      'dock-browser',
      true,
    );
  });

  it('removes the renderer identity when the owning registration unmounts', async () => {
    flushSync(() => root.render(<Harness surfaceKind="canvas-node" />));
    await flushEffects();
    expect(mountedWebviewIdentityForWebContents(42)?.surfaceKind).toBe('canvas-node');

    flushSync(() => root.render(null));

    expect(mountedWebviewIdentityForWebContents(42)).toBeUndefined();
  });
});

const Harness = ({ surfaceKind }: { surfaceKind: 'canvas-node' | 'dock-browser' }) => {
  useWebviewRegistration({
    webview,
    workspaceId: 'workspace-1',
    nodeId: 'dock-tab-1',
    enabled: true,
    surfaceKind,
  });
  return null;
};

const flushEffects = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};
