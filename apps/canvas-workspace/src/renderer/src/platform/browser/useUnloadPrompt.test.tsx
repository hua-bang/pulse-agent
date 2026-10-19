// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddedWebviewTag } from './types';
import { useUnloadPrompt } from './useUnloadPrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Blocked = (payload: { webContentsId: number }) => void;

const iframe = {
  expectUnload: vi.fn(),
  allowUnload: vi.fn(),
  onUnloadBlocked: vi.fn((callback: Blocked) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }),
};
const listeners = new Set<Blocked>();
const emitBlocked = (webContentsId: number) => act(() => listeners.forEach((listener) => listener({ webContentsId })));

const webview = Object.assign(document.createElement('div'), {
  getWebContentsId: () => 7,
}) as unknown as EmbeddedWebviewTag;

let latest: ReturnType<typeof useUnloadPrompt>;
const onBlocked = vi.fn();
const Probe = () => {
  latest = useUnloadPrompt(webview, onBlocked);
  return null;
};

describe('useUnloadPrompt', () => {
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { iframe };
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
  });

  afterEach(() => act(() => root.unmount()));

  it('asks after an announced action is vetoed and replays it on Leave', () => {
    const action = vi.fn();
    latest.announce(action);
    expect(iframe.expectUnload).toHaveBeenCalledWith(7);

    emitBlocked(7);
    expect(latest.prompt.blocked).toBe(true);
    expect(onBlocked).toHaveBeenCalledOnce();

    act(() => latest.prompt.leave());
    expect(iframe.allowUnload).toHaveBeenCalledWith(7);
    expect(action).toHaveBeenCalledOnce();
    expect(latest.prompt.blocked).toBe(false);
  });

  it('drops the action on Stay', () => {
    const action = vi.fn();
    latest.announce(action);
    emitBlocked(7);
    act(() => latest.prompt.stay());
    act(() => latest.prompt.leave());
    expect(latest.prompt.blocked).toBe(false);
    expect(iframe.allowUnload).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('ignores vetoes for other guests', () => {
    latest.announce(vi.fn());
    emitBlocked(8);
    expect(latest.prompt.blocked).toBe(false);
  });
});
